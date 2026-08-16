/* ===================== Bedrock — progress check-in / photo scan ===================== */
/* Photos are resized + compressed client-side and stored as base64 in
   localStorage (profile.history.checkins[].photo). Nothing leaves the
   phone unless the user explicitly taps "ask Claude" about a photo, in
   which case the photo is sent directly to Anthropic for that one request. */

const Scan = (() => {
  function fileToCompressedDataUrl(file, maxW = 480) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = e => { img.src = e.target.result; };
      reader.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.62));
      };
      img.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const SCAN_TIPS = [
    'Tip: prop your phone at chest height, about 6 feet back.',
    'Tip: same time of day (e.g. morning, before eating) keeps comparisons fair.',
    'Tip: plain background, same spot each time makes changes easier to spot.',
    'Tip: relaxed stance, arms slightly away from your sides, facing the camera.'
  ];
  function randomTip() { return SCAN_TIPS[Math.floor(Math.random() * SCAN_TIPS.length)]; }

  function addCheckin(profile, { photo, weight, waist, chest, arm, hips, thigh, poseKeypoints }) {
    const num = v => (v != null && v !== '' ? Number(v) : null);
    const entry = {
      id: 'c_' + Date.now().toString(36),
      date: Date.now(),
      photo: photo || null,
      poseKeypoints: poseKeypoints || null, // normalized (0-1) MoveNet landmarks captured at shot time, if available
      weight: num(weight), waist: num(waist), chest: num(chest), arm: num(arm), hips: num(hips), thigh: num(thigh),
    };
    profile.history.checkins = profile.history.checkins || [];
    profile.history.checkins.push(entry);
    Store.upsertProfile(profile);
    return entry;
  }

  function latestPhoto(profile) {
    const list = (profile.history.checkins || []).filter(c => c.photo);
    return list.length ? list[list.length - 1] : null;
  }

  return { fileToCompressedDataUrl, randomTip, addCheckin, latestPhoto };
})();
