// =========================================================================
// CẤU HÌNH GITHUB REPO
// Nếu để trống '', code sẽ tự nhận diện từ URL <username>.github.io/<repo>
// Nếu bạn dùng tên miền riêng hoặc test ở máy cá nhân (localhost), hãy điền vào đây:
// =========================================================================
const CONFIG = {
  githubUser: '', // Ví dụ: 'nguyenvana'
  githubRepo: '', // Ví dụ: 'trac-nghiem-online'
  branch: 'main'  // Nhánh mặc định trên GitHub (thường là 'main' hoặc 'master')
};

function getRepoInfo() {
  if (CONFIG.githubUser && CONFIG.githubRepo) {
    return { owner: CONFIG.githubUser, repo: CONFIG.githubRepo };
  }
  const host = window.location.hostname; // <owner>.github.io
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  if (host.endsWith('github.io') && pathParts.length > 0) {
    return {
      owner: host.split('.')[0],
      repo: pathParts[0]
    };
  }
  return null;
}

// =========================================================================
// BỘ TỔNG HỢP ÂM THANH PHẢN HỒI (KHÔNG CẦN FILE MP3 NGOÀI)
// =========================================================================
class SoundEngine {
  constructor() {
    this.enabled = true;
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTone(freq, type, duration, startTime = 0, volume = 0.2) {
    if (!this.enabled) return;
    this.init();
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startTime);

    gain.gain.setValueAtTime(volume, this.ctx.currentTime + startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + startTime + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(this.ctx.currentTime + startTime);
    osc.stop(this.ctx.currentTime + startTime + duration);
  }

  // Âm thanh trả lời ĐÚNG (Hợp âm đi lên vui tai)
  playCorrect() {
    this.playTone(523.25, 'triangle', 0.14, 0.00, 0.25); // C5
    this.playTone(659.25, 'triangle', 0.14, 0.09, 0.25); // E5
    this.playTone(783.99, 'triangle', 0.18, 0.18, 0.25); // G5
    this.playTone(1046.5, 'sine',     0.35, 0.27, 0.25); // C6
  }

  // Âm thanh trả lời SAI (Trầm ấm đi xuống)
  playWrong() {
    this.playTone(246.94, 'sawtooth', 0.22, 0.00, 0.15); // B3
    this.playTone(196.00, 'sawtooth', 0.35, 0.16, 0.15); // G3
  }

  // Âm thanh hoàn thành bài thi
  playComplete() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      this.playTone(n, 'triangle', 0.22, idx * 0.12, 0.22);
    });
  }
}

const sound = new SoundEngine();

document.getElementById('soundToggle').addEventListener('click', (e) => {
  sound.enabled = !sound.enabled;
  e.target.textContent = sound.enabled ? '🔊 Âm thanh: Bật' : '🔇 Âm thanh: Tắt';
  if (sound.enabled) sound.playTone(600, 'sine', 0.1);
});

// =========================================================================
// BỘ PHÂN TÍCH ĐỊNH DẠNG FILE ĐỀ .TXT
// =========================================================================
function parseQuizTxt(rawText) {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const questions = [];

  let currentQ = null;
  let questionBuffer = [];

  // Khớp các dòng dạng: *a. Nội dung hoặc b. Nội dung
  const optionRegex = /^\s*(\*)?\s*([a-dA-D])[\.\)\:]\s*(.+)$/;

  const pushCurrentQuestion = () => {
    if (currentQ && currentQ.options.length >= 2) {
      questions.push(currentQ);
    }
    currentQ = null;
    questionBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = line.match(optionRegex);
    if (match) {
      if (!currentQ) {
        currentQ = {
          question: questionBuffer.join('\n').trim(),
          options: []
        };
      }
      currentQ.options.push({
        label: match[2].toLowerCase(),
        text: match[3].trim(),
        isCorrect: Boolean(match[1])
      });
    } else {
      // Nếu đã thu thập xong đáp án của câu trước mà gặp dòng văn bản mới -> sang câu mới
      if (currentQ && currentQ.options.length > 0) {
        pushCurrentQuestion();
      }
      questionBuffer.push(trimmed);
    }
  }
  pushCurrentQuestion();

  return questions;
}

// =========================================================================
// QUẢN LÝ TRẠNG THÁI & TẢI DỮ LIỆU TỪ GITHUB
// =========================================================================
let state = {
  currentSubject: '',
  currentExamFile: '',
  rawQuestions: [],
  questions: [],
  currentIndex: 0,
  score: 0,
  streak: 0,
  maxStreak: 0,
  correctCount: 0,
  wrongHistory: [],
  answered: false
};

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function setLoader(show, errorMsg = '') {
  document.getElementById('loader').classList.toggle('hidden', !show);
  const errBox = document.getElementById('errorBox');
  if (errorMsg) {
    errBox.textContent = errorMsg;
    errBox.classList.remove('hidden');
  } else {
    errBox.classList.add('hidden');
  }
}

async function fetchGitHubContents(subPath = '') {
  const repoInfo = getRepoInfo();
  if (!repoInfo) {
    throw new Error(
      'Không tự nhận diện được GitHub Repo. Hãy mở file app.js và điền githubUser + githubRepo vào mục CONFIG.'
    );
  }
  const encodedPath = subPath
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');

  const apiPath = encodedPath ? `content/${encodedPath}` : 'content';
  const cacheKey = `gh_cache_${repoInfo.owner}_${repoInfo.repo}_${apiPath}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return JSON.parse(cached);

  const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${apiPath}?ref=${CONFIG.branch}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Không thể tải thư mục /${apiPath} (Mã lỗi ${res.status}). Kiểm tra lại thư mục content trên GitHub.`);
  }
  const data = await res.json();
  sessionStorage.setItem(cacheKey, JSON.stringify(data));
  return data;
}

// Bước 1: Tải danh sách thư mục môn học trong /content
async function loadSubjects() {
  state.currentSubject = '';
  document.getElementById('quizOptionsBar').classList.add('hidden');
  document.getElementById('breadcrumb').innerHTML =
    `<span class="crumb active" onclick="loadSubjects()">📚 Danh sách môn học</span>`;

  const grid = document.getElementById('gridList');
  grid.innerHTML = '';
  setLoader(true);

  try {
    const items = await fetchGitHubContents('');
    const folders = items.filter(item => item.type === 'dir');
    setLoader(false);

    if (folders.length === 0) {
      setLoader(false, 'Chưa có thư mục môn học nào trong /content.');
      return;
    }

    folders.forEach(folder => {
      const card = document.createElement('div');
      card.className = 'folder-card';
      card.innerHTML = `
        <div class="folder-icon">📁</div>
        <div class="folder-title">${folder.name}</div>
        <div class="folder-meta">Nhấn để xem danh sách đề</div>
      `;
      card.onclick = () => loadExams(folder.name);
      grid.appendChild(card);
    });
  } catch (err) {
    setLoader(false, err.message);
  }
}

// Bước 2: Tải danh sách file de_xxx.txt trong môn học đã chọn
async function loadExams(subjectName) {
  state.currentSubject = subjectName;
  document.getElementById('quizOptionsBar').classList.remove('hidden');
  document.getElementById('breadcrumb').innerHTML = `
    <span class="crumb" onclick="loadSubjects()">📚 Môn học</span>
    <span>›</span>
    <span class="crumb active">${subjectName}</span>
  `;

  const grid = document.getElementById('gridList');
  grid.innerHTML = '';
  setLoader(true);

  try {
    const items = await fetchGitHubContents(subjectName);
    const txtFiles = items.filter(item => item.type === 'file' && item.name.endsWith('.txt'));
    setLoader(false);

    if (txtFiles.length === 0) {
      setLoader(false, `Thư mục "${subjectName}" chưa có file .txt nào.`);
      return;
    }

    txtFiles.forEach(file => {
      const displayName = file.name.replace(/\.txt$/i, '').replace(/_/g, ' ').toUpperCase();
      const card = document.createElement('div');
      card.className = 'folder-card';
      card.innerHTML = `
        <div class="folder-icon">📝</div>
        <div class="folder-title">${displayName}</div>
        <div class="folder-meta">File: ${file.name}</div>
      `;
      card.onclick = () => startExam(subjectName, file.name);
      grid.appendChild(card);
    });
  } catch (err) {
    setLoader(false, err.message);
  }
}

// Bước 3: Tải nội dung file .txt và bắt đầu thi
async function startExam(subjectName, fileName) {
  setLoader(true);
  try {
    // Tải trực tiếp file tĩnh từ GitHub Pages (không tốn quota API)
    const fileUrl = `./content/${encodeURIComponent(subjectName)}/${encodeURIComponent(fileName)}?t=${Date.now()}`;
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error('Không đọc được nội dung file đề thi.');

    const rawText = await res.text();
    const parsed = parseQuizTxt(rawText);
    setLoader(false);

    if (parsed.length === 0) {
      alert('File đề không có câu hỏi hợp lệ. Hãy kiểm tra lại định dạng *a. b. c. d.');
      return;
    }

    state.currentExamFile = fileName;
    state.rawQuestions = parsed;
    setupQuizRun();
  } catch (err) {
    setLoader(false, err.message);
  }
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function setupQuizRun() {
  const shouldShuffleQ = document.getElementById('shuffleQuestions').checked;
  const shouldShuffleA = document.getElementById('shuffleAnswers').checked;

  let qList = JSON.parse(JSON.stringify(state.rawQuestions));
  if (shouldShuffleQ) qList = shuffleArray(qList);
  if (shouldShuffleA) {
    qList.forEach(q => {
      q.options = shuffleArray(q.options);
    });
  }

  state.questions = qList;
  state.currentIndex = 0;
  state.score = 0;
  state.streak = 0;
  state.maxStreak = 0;
  state.correctCount = 0;
  state.wrongHistory = [];

  showScreen('quizScreen');
  renderQuestion();
}

function renderQuestion() {
  state.answered = false;
  document.getElementById('feedbackBanner').classList.add('hidden');

  const total = state.questions.length;
  const qObj = state.questions[state.currentIndex];

  document.getElementById('qCounter').textContent = `${state.currentIndex + 1} / ${total}`;
  document.getElementById('streakBadge').textContent = `🔥 Chuỗi: ${state.streak}`;
  document.getElementById('scoreBadge').textContent = `Điểm: ${state.score}`;
  document.getElementById('progressFill').style.width = `${(state.currentIndex / total) * 100}%`;
  document.getElementById('questionText').textContent = qObj.question;

  const grid = document.getElementById('answersGrid');
  grid.innerHTML = '';

  const labels = ['A', 'B', 'C', 'D'];
  qObj.options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.className = `answer-tile tile-${idx % 4}`;
    btn.innerHTML = `
      <span class="opt-badge">${labels[idx] || opt.label}</span>
      <span>${opt.text}</span>
    `;
    btn.onclick = () => handleAnswer(idx, btn);
    grid.appendChild(btn);
  });
}

function handleAnswer(selectedIdx, selectedBtn) {
  if (state.answered) return;
  state.answered = true;

  const qObj = state.questions[state.currentIndex];
  const chosenOption = qObj.options[selectedIdx];
  const allTiles = document.querySelectorAll('.answer-tile');

  allTiles.forEach((tile, idx) => {
    tile.disabled = true;
    const isOptCorrect = qObj.options[idx].isCorrect;
    if (isOptCorrect) {
      tile.classList.add('is-correct');
    } else if (idx === selectedIdx) {
      tile.classList.add('is-wrong');
    } else {
      tile.classList.add('dimmed');
    }
  });

  const banner = document.getElementById('feedbackBanner');
  banner.classList.remove('hidden', 'correct', 'wrong');

  if (chosenOption.isCorrect) {
    sound.playCorrect();
    state.streak += 1;
    if (state.streak > state.maxStreak) state.maxStreak = state.streak;
    state.correctCount += 1;

    // Cộng điểm cơ bản + thưởng chuỗi đúng liên tiếp
    const streakBonus = Math.min((state.streak - 1) * 20, 100);
    const earned = 100 + streakBonus;
    state.score += earned;

    banner.classList.add('correct');
    document.getElementById('feedbackIcon').textContent = '🎉';
    document.getElementById('feedbackTitle').textContent = 'Chính xác!';
    document.getElementById('feedbackSub').textContent =
      streakBonus > 0 ? `+${earned} điểm (Thưởng chuỗi 🔥 +${streakBonus})` : `+100 điểm`;
  } else {
    sound.playWrong();
    state.streak = 0;

    const rightOpt = qObj.options.find(o => o.isCorrect);
    state.wrongHistory.push({
      question: qObj.question,
      chosen: chosenOption.text,
      correct: rightOpt ? rightOpt.text : '(Chưa đánh dấu * đáp án đúng)'
    });

    banner.classList.add('wrong');
    document.getElementById('feedbackIcon').textContent = '💥';
    document.getElementById('feedbackTitle').textContent = 'Chưa chính xác!';
    document.getElementById('feedbackSub').textContent =
      `Đáp án đúng: ${rightOpt ? rightOpt.text : ''}`;
  }

  document.getElementById('streakBadge').textContent = `🔥 Chuỗi: ${state.streak}`;
  document.getElementById('scoreBadge').textContent = `Điểm: ${state.score}`;

  const isLast = state.currentIndex === state.questions.length - 1;
  document.getElementById('nextBtn').textContent = isLast ? 'Xem kết quả 🏆' : 'Câu tiếp theo ➔';
}

function nextQuestion() {
  if (state.currentIndex < state.questions.length - 1) {
    state.currentIndex += 1;
    renderQuestion();
  } else {
    finishQuiz();
  }
}

function finishQuiz() {
  sound.playComplete();
  document.getElementById('progressFill').style.width = '100%';
  showScreen('resultScreen');

  const total = state.questions.length;
  const accuracy = Math.round((state.correctCount / total) * 100);

  document.getElementById('resultExamName').textContent =
    `${state.currentSubject} — ${state.currentExamFile}`;
  document.getElementById('finalScore').textContent = state.score;
  document.getElementById('finalAccuracy').textContent = `${accuracy}%`;
  document.getElementById('finalCorrect').textContent = `${state.correctCount} / ${total}`;
  document.getElementById('finalStreak').textContent = state.maxStreak;

  const reviewSection = document.getElementById('reviewSection');
  const reviewList = document.getElementById('reviewList');
  reviewList.innerHTML = '';

  if (state.wrongHistory.length > 0) {
    reviewSection.classList.remove('hidden');
    state.wrongHistory.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'review-item';
      div.innerHTML = `
        <div class="review-q">Câu ${i + 1}: ${item.question}</div>
        <div class="review-wrong">✘ Bạn chọn: ${item.chosen}</div>
        <div class="review-right">✔ Đáp án đúng: ${item.correct}</div>
      `;
      reviewList.appendChild(div);
    });
  } else {
    reviewSection.classList.add('hidden');
  }
}

function restartQuiz() {
  setupQuizRun();
}

function confirmExit() {
  if (confirm('Bạn muốn thoát bài làm hiện tại?')) {
    goHome();
  }
}

function goHome() {
  showScreen('homeScreen');
  if (state.currentSubject) {
    loadExams(state.currentSubject);
  } else {
    loadSubjects();
  }
}

// Khởi chạy lần đầu
loadSubjects();