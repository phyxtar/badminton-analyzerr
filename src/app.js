// ── State ──
let apiKey = localStorage.getItem('gemini_key') || '';
let videoFile = null;
let analysisResults = null;

// ── On Load ──
window.onload = () => {
  if (apiKey) {
    document.getElementById('apiKeyInput').value = apiKey;
    setKeyStatus('✅ Key loaded from memory', 'ok');
  }
};

// ── Save API Key ──
function saveKey() {
  const val = document.getElementById('apiKeyInput').value.trim();
  if (!val) { setKeyStatus('❌ Key empty hai!', 'err'); return; }
  apiKey = val;
  localStorage.setItem('gemini_key', val);
  setKeyStatus('✅ Key saved! Ab video upload karo.', 'ok');
}

function setKeyStatus(msg, type) {
  const el = document.getElementById('keyStatus');
  el.textContent = msg;
  el.className = 'key-status ' + type;
}

// ── Handle Video Upload ──
function handleVideo(e) {
  videoFile = e.target.files[0];
  if (!videoFile) return;
  const url = URL.createObjectURL(videoFile);
  const preview = document.getElementById('previewVideo');
  const uploadArea = document.getElementById('uploadArea');
  preview.src = url;
  preview.style.display = 'block';
  uploadArea.querySelector('.upload-text').textContent = '✅ ' + videoFile.name;
  document.getElementById('analyzeBtn').style.display = 'block';
}

// ── Extract Frames from Video ──
function extractFrames(video, canvas) {
  return new Promise((resolve) => {
    const frames = [];
    const ctx = canvas.getContext('2d');
    canvas.width = 640;
    canvas.height = 360;
    const duration = video.duration;
    const times = [];
    for (let t = 1; t < duration; t += 2) times.push(parseFloat(t.toFixed(1)));
    // max 8 frames
    const selected = times.length > 8
      ? times.filter((_, i) => i % Math.ceil(times.length / 8) === 0).slice(0, 8)
      : times;
    if (selected.length === 0) selected.push(1);

    let idx = 0;
    const next = () => {
      if (idx >= selected.length) { resolve(frames); return; }
      video.currentTime = selected[idx];
    };
    video.onseeked = () => {
      ctx.drawImage(video, 0, 0, 640, 360);
      frames.push({ time: selected[idx], dataUrl: canvas.toDataURL('image/jpeg', 0.75) });
      idx++;
      next();
    };
    next();
  });
}

// ── Call Gemini API ──
async function analyzeFrame(base64data) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const prompt = `You are an expert badminton coach and sports analyst. Analyze this frame from a badminton match video.

Reply ONLY with raw JSON (no markdown, no explanation, no backticks):
{
  "player_detected": true,
  "shot_type": "smash|drop|clear|drive|serve|net_shot|lob|unknown",
  "posture_score": 7,
  "footwork_quality": "excellent|good|average|poor",
  "court_position": "front|mid|back|unknown",
  "body_balance": "balanced|leaning_forward|leaning_back|unstable",
  "racket_height": "high|mid|low",
  "observations": ["Player is in ready position", "Weight on front foot"],
  "improvement_tips": ["Keep racket higher during defense", "Improve wrist snap on smash"]
}

If no badminton player is visible, set player_detected to false and use "unknown"/"poor" for other fields.`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: base64data } }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 600 }
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'Gemini API error');
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { player_detected: false };
  }
}

// ── Main Analysis ──
async function startAnalysis() {
  if (!apiKey) { showError('Pehle API key daalo upar!'); return; }
  if (!videoFile) { showError('Pehle video upload karo!'); return; }

  // Show progress, hide other sections
  document.getElementById('analyzeBtn').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('progressSection').style.display = 'block';
  clearError();

  const canvas = document.getElementById('hiddenCanvas');
  const video = document.createElement('video');
  video.src = URL.createObjectURL(videoFile);

  try {
    setProgress(5, 'Video load ho raha hai...');
    await new Promise(r => { video.onloadedmetadata = r; video.load(); });

    setProgress(15, 'Frames extract ho rahe hain...');
    const frames = await extractFrames(video, canvas);

    const frameResults = [];
    for (let i = 0; i < frames.length; i++) {
      setProgress(
        15 + Math.round(((i + 1) / frames.length) * 80),
        `Frame ${i + 1} of ${frames.length} analyze ho raha hai...`
      );
      const base64 = frames[i].dataUrl.split(',')[1];
      try {
        const result = await analyzeFrame(base64);
        frameResults.push({ time: frames[i].time, ...result });
      } catch (e) {
        if (e.message.includes('quota') || e.message.includes('limit') || e.message.includes('RESOURCE_EXHAUSTED')) {
          showError('⚠️ Gemini free limit hit! Kal try karo ya naya Google account se nayi key banao aistudio.google.com pe.');
        }
        frameResults.push({ time: frames[i].time, player_detected: false });
      }
    }

    setProgress(100, 'Analysis complete!');
    buildResults(frameResults);

  } catch (e) {
    showError('Error: ' + e.message);
    document.getElementById('analyzeBtn').style.display = 'block';
  } finally {
    document.getElementById('progressSection').style.display = 'none';
  }
}

// ── Build Results ──
function buildResults(frames) {
  const valid = frames.filter(f => f.player_detected !== false);

  const shotCounts = {}, fwCounts = {};
  let totalPosture = 0;
  const allTips = new Set(), allObs = new Set();

  valid.forEach(f => {
    if (f.shot_type && f.shot_type !== 'unknown') shotCounts[f.shot_type] = (shotCounts[f.shot_type] || 0) + 1;
    if (f.footwork_quality) fwCounts[f.footwork_quality] = (fwCounts[f.footwork_quality] || 0) + 1;
    if (f.posture_score) totalPosture += Number(f.posture_score);
    (f.improvement_tips || []).forEach(t => allTips.add(t));
    (f.observations || []).forEach(o => allObs.add(o));
  });

  const avgPosture = valid.length ? (totalPosture / valid.length).toFixed(1) : 0;
  const dominantShot = Object.entries(shotCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';
  const dominantFw = Object.entries(fwCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  analysisResults = { frames, valid, shotCounts, fwCounts, avgPosture, dominantShot, dominantFw, allTips: [...allTips], allObs: [...allObs] };

  renderStatsCards(avgPosture, dominantShot, dominantFw, frames.length);
  renderBarChart('shotChart', shotCounts, valid.length);
  renderBarChart('footworkChart', fwCounts, valid.length);
  renderTips([...allTips].slice(0, 6));
  renderObs([...allObs].slice(0, 6));
  renderTimeline(valid);

  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth' });
}

// ── Render Stats Cards ──
function renderStatsCards(avgPosture, shot, fw, total) {
  const scoreColor = s => Number(s) >= 8 ? '#22c55e' : Number(s) >= 5 ? '#f59e0b' : '#ef4444';
  const fwColor = f => ({ excellent: '#22c55e', good: '#3b82f6', average: '#f59e0b', poor: '#ef4444' }[f] || '#94a3b8');
  const cards = [
    { icon: '🎞️', value: total, label: 'Frames Analyzed', color: '#3b82f6' },
    { icon: '🧍', value: `${avgPosture}/10`, label: 'Avg Posture Score', color: scoreColor(avgPosture) },
    { icon: '🏸', value: shot.replace(/_/g, ' '), label: 'Dominant Shot', color: '#818cf8' },
    { icon: '👟', value: fw, label: 'Footwork Quality', color: fwColor(fw) }
  ];
  document.getElementById('statsGrid').innerHTML = cards.map(c => `
    <div class="stat-card" style="border-color:${c.color}44">
      <div class="stat-icon">${c.icon}</div>
      <div class="stat-value" style="color:${c.color}">${c.value}</div>
      <div class="stat-label">${c.label}</div>
    </div>
  `).join('');
}

// ── Render Bar Chart ──
function renderBarChart(id, counts, total) {
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) { document.getElementById(id).innerHTML = '<p style="color:#64748b;font-size:13px">No data detected</p>'; return; }
  document.getElementById(id).innerHTML = sorted.map(([label, count]) => {
    const pct = Math.round((count / total) * 100);
    return `<div class="bar-row">
      <div class="bar-label"><span>${label.replace(/_/g, ' ')}</span><span>${pct}% (${count}x)</span></div>
      <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

// ── Render Tips ──
function renderTips(tips) {
  document.getElementById('tipsList').innerHTML = tips.length
    ? tips.map(t => `<div class="tip-item"><span class="icon" style="color:#22c55e">✓</span><span>${t}</span></div>`).join('')
    : '<p style="color:#64748b;font-size:13px">No tips extracted</p>';
}

// ── Render Observations ──
function renderObs(obs) {
  document.getElementById('obsList').innerHTML = obs.length
    ? obs.map(o => `<div class="tip-item"><span class="icon" style="color:#f59e0b">•</span><span>${o}</span></div>`).join('')
    : '<p style="color:#64748b;font-size:13px">No observations extracted</p>';
}

// ── Render Timeline ──
function renderTimeline(frames) {
  const scoreColor = s => Number(s) >= 8 ? '#22c55e' : Number(s) >= 5 ? '#f59e0b' : '#ef4444';
  const fwColor = f => ({ excellent: '#22c55e', good: '#3b82f6', average: '#f59e0b', poor: '#ef4444' }[f] || '#94a3b8');
  document.getElementById('timeline').innerHTML = frames.map(f => `
    <div class="timeline-row">
      <span class="tl-time">@${Number(f.time).toFixed(1)}s</span>
      <span class="tl-shot">${(f.shot_type || 'unknown').replace(/_/g, ' ')}</span>
      <span class="tl-posture" style="color:${scoreColor(f.posture_score)}">Posture: ${f.posture_score ?? '?'}/10</span>
      <span class="tl-foot" style="color:${fwColor(f.footwork_quality)}">${f.footwork_quality || '?'}</span>
    </div>
  `).join('');
}

// ── Helpers ──
function setProgress(pct, msg) {
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressMsg').textContent = msg;
}

function showError(msg) {
  let el = document.getElementById('errorBox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'errorBox';
    el.className = 'error-box';
    document.getElementById('app').insertBefore(el, document.getElementById('progressSection'));
  }
  el.textContent = msg;
  el.style.display = 'block';
}

function clearError() {
  const el = document.getElementById('errorBox');
  if (el) el.style.display = 'none';
}

function resetApp() {
  videoFile = null;
  analysisResults = null;
  document.getElementById('previewVideo').style.display = 'none';
  document.getElementById('previewVideo').src = '';
  document.getElementById('uploadArea').querySelector('.upload-text').textContent = 'Click to upload video';
  document.getElementById('analyzeBtn').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('videoInput').value = '';
  clearError();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
