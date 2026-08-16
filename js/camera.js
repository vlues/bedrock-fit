/* ===================== Bedrock — in-page camera with overlay guides ===================== */
/*
  Uses getUserMedia to show a live viewfinder inside the app (instead of
  handing off to the OS camera app), so we can overlay framing guides:
   - "food" guide: a centered framing box + a nudge to include something of
     known size in shot. Research on photo-based dietary assessment (e.g.
     remote food photography method studies) shows a size reference in
     frame meaningfully improves portion-size estimation accuracy — so this
     isn't decorative, it's the same trick real food-logging research uses.
   - "body" guide: a head-to-toe framing outline + a center line, so
     check-in photos land in roughly the same spot/scale every time, which
     is what actually makes before/after comparisons meaningful.
  Falls back to the plain file input (already wired in app.js) if the
  browser has no camera API or the user denies permission — this is
  progressive enhancement, not a hard requirement.
*/

const Camera = (() => {
  let stream = null;
  let currentFacing = 'environment';
  let onCaptureCb = null;
  let currentGuide = 'food';
  let poseDetector = null;
  let poseLoadAttempted = false;
  let poseLoopId = null;
  let lastPose = null; // latest detected keypoints, normalized 0-1
  let torchOn = false;
  let pendingShot = null; // { dataUrl, keypoints } — held during retake/confirm review

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  // MoveNet 17-keypoint skeleton — a real, well-established browser pose
  // model (TensorFlow.js), used here for framing/posture guidance only.
  // Deliberately NOT used to estimate body fat/composition — a single 2D
  // pose skeleton has no way to see under the skin, and Bedrock doesn't
  // claim otherwise anywhere in the app.
  const POSE_EDGES = [
    ['left_shoulder', 'right_shoulder'], ['left_shoulder', 'left_elbow'], ['left_elbow', 'left_wrist'],
    ['right_shoulder', 'right_elbow'], ['right_elbow', 'right_wrist'],
    ['left_shoulder', 'left_hip'], ['right_shoulder', 'right_hip'], ['left_hip', 'right_hip'],
    ['left_hip', 'left_knee'], ['left_knee', 'left_ankle'], ['right_hip', 'right_knee'], ['right_knee', 'right_ankle'],
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Lazy-loaded only when the body-scan camera opens — a multi-MB model
  // has no business loading on every page view. Any failure here (offline,
  // blocked script, slow connection) just means no live skeleton overlay;
  // the static guide + capture flow works exactly the same either way.
  async function ensurePoseModel() {
    if (poseDetector || poseLoadAttempted) return poseDetector;
    poseLoadAttempted = true;
    try {
      await withTimeout(Promise.all([
        loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4/dist/tf.min.js'),
        loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2/dist/pose-detection.min.js')
      ]), 9000, 'pose-model-scripts');
      if (!window.tf || !window.poseDetection) return null;
      poseDetector = await window.poseDetection.createDetector(
        window.poseDetection.SupportedModels.MoveNet,
        { modelType: window.poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
      );
    } catch (e) { poseDetector = null; }
    return poseDetector;
  }

  function drawPoseOverlay(keypoints, canvas, videoW, videoH) {
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const sx = canvas.width / videoW, sy = canvas.height / videoH;
    const byName = {}; keypoints.forEach(k => { if (k.score > 0.35) byName[k.name] = k; });
    ctx.strokeStyle = 'rgba(244,237,224,0.85)'; ctx.lineWidth = 3;
    POSE_EDGES.forEach(([a, b]) => {
      if (byName[a] && byName[b]) {
        ctx.beginPath();
        ctx.moveTo(byName[a].x * sx, byName[a].y * sy);
        ctx.lineTo(byName[b].x * sx, byName[b].y * sy);
        ctx.stroke();
      }
    });
    ctx.fillStyle = '#b5674a';
    Object.values(byName).forEach(k => { ctx.beginPath(); ctx.arc(k.x * sx, k.y * sy, 4, 0, Math.PI * 2); ctx.fill(); });
  }

  async function poseLoop() {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraPoseCanvas');
    if (!poseDetector || !video.videoWidth || !canvas) { poseLoopId = requestAnimationFrame(poseLoop); return; }
    try {
      const poses = await poseDetector.estimatePoses(video);
      if (poses && poses[0]) {
        lastPose = poses[0].keypoints.map(k => ({ name: k.name, x: k.x / video.videoWidth, y: k.y / video.videoHeight, score: k.score }));
        drawPoseOverlay(poses[0].keypoints, canvas, video.videoWidth, video.videoHeight);
      }
    } catch (e) { /* skip this frame */ }
    poseLoopId = setTimeout(() => requestAnimationFrame(poseLoop), 150); // ~6-7fps is plenty for a framing guide
  }

  // Torch (flashlight) — real hardware capability on most rear cameras.
  // Only shown when the active track actually reports it, so it's zero
  // extra clutter on devices/browsers that don't support it (mostly iOS
  // Safari, which doesn't expose torch control to the web).
  function torchSupported() {
    if (!stream) return false;
    const track = stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    return !!caps.torch;
  }
  async function toggleTorch() {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    try {
      torchOn = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
    } catch (e) { torchOn = !torchOn; /* revert if the browser rejected it */ }
    updateTorchButton();
  }
  function updateTorchButton() {
    const btn = document.getElementById('cameraTorch');
    if (!btn) return;
    btn.hidden = !torchSupported();
    btn.classList.toggle('camera-torch-on', torchOn);
    btn.textContent = torchOn ? '🔦 On' : '🔦';
  }

  async function open({ guide = 'food', tip = '', onCapture }) {
    if (!supported()) return { ok: false, error: 'unsupported' };
    onCaptureCb = onCapture;
    currentGuide = guide;
    lastPose = null;
    torchOn = false;
    pendingShot = null;
    const overlay = document.getElementById('cameraOverlay');
    const video = document.getElementById('cameraVideo');
    const guideEl = document.getElementById('cameraGuide');
    guideEl.className = 'camera-guide camera-guide-' + guide;
    document.getElementById('cameraTip').textContent = tip;
    const review = document.getElementById('cameraReview');
    if (review) review.hidden = true;
    overlay.hidden = false;
    try {
      stream = await withTimeout(navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false
      }), 10000, 'camera');
      video.srcObject = stream;
    } catch (e) {
      overlay.hidden = true;
      return { ok: false, error: 'denied' };
    }
    updateTorchButton();
    if (guide === 'body') {
      ensurePoseModel().then(det => { if (det) poseLoop(); });
    }
    return { ok: true };
  }

  function close() {
    const overlay = document.getElementById('cameraOverlay');
    if (overlay) overlay.hidden = true;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (poseLoopId) { clearTimeout(poseLoopId); cancelAnimationFrame(poseLoopId); poseLoopId = null; }
    const canvas = document.getElementById('cameraPoseCanvas');
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    pendingShot = null;
    torchOn = false;
  }

  // Quick full-screen white flash so the shutter tap feels responsive even
  // while the frame is being processed — pure visual feedback, ~120ms.
  function flashEffect() {
    const flash = document.getElementById('cameraFlash');
    if (!flash) return;
    flash.classList.add('flash-active');
    setTimeout(() => flash.classList.remove('flash-active'), 150);
  }

  // Capture doesn't hand the photo off immediately — it drops into a
  // review step (Use Photo / Retake) so a blurry or badly-framed shot
  // never gets saved without the user seeing it first. One extra tap,
  // fully the user's call.
  function capture() {
    const video = document.getElementById('cameraVideo');
    const canvas = document.getElementById('cameraCanvas');
    if (!video.videoWidth) return; // not ready yet
    flashEffect();
    const maxW = 480;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.62);
    const keypoints = currentGuide === 'body' ? lastPose : null;
    pendingShot = { dataUrl, keypoints };
    const review = document.getElementById('cameraReview');
    const reviewImg = document.getElementById('cameraReviewImg');
    if (review && reviewImg) {
      reviewImg.src = dataUrl;
      review.hidden = false;
    } else {
      confirmShot(); // no review UI wired — fall back to immediate use
    }
  }

  function retake() {
    pendingShot = null;
    const review = document.getElementById('cameraReview');
    if (review) review.hidden = true;
  }

  function confirmShot() {
    if (!pendingShot) return;
    const { dataUrl, keypoints } = pendingShot;
    const cb = onCaptureCb;
    close();
    if (cb) cb(dataUrl, keypoints);
  }

  async function switchCamera() {
    currentFacing = currentFacing === 'environment' ? 'user' : 'environment';
    if (stream) stream.getTracks().forEach(t => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: currentFacing, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false
      });
      document.getElementById('cameraVideo').srcObject = stream;
      torchOn = false;
      updateTorchButton();
    } catch (e) { /* keep previous stream state if the switch fails */ }
  }

  function wire() {
    const shutter = document.getElementById('cameraShutter');
    const cancel = document.getElementById('cameraCancel');
    const switchBtn = document.getElementById('cameraSwitch');
    const torchBtn = document.getElementById('cameraTorch');
    const useBtn = document.getElementById('cameraUsePhoto');
    const retakeBtn = document.getElementById('cameraRetake');
    if (shutter) shutter.addEventListener('click', capture);
    if (cancel) cancel.addEventListener('click', close);
    if (switchBtn) switchBtn.addEventListener('click', switchCamera);
    if (torchBtn) torchBtn.addEventListener('click', toggleTorch);
    if (useBtn) useBtn.addEventListener('click', confirmShot);
    if (retakeBtn) retakeBtn.addEventListener('click', retake);
  }

  return { open, close, wire, supported };
})();
