/* ==========================================================================
 * EBS 수능 VOCA 1800 - English Vocabulary Learning App
 * Features: SRS Flashcards, Quiz, Dictation, Stats, Roots, Phrasal Verbs,
 *           Collocations, Word Families, Confusing Pairs, IPA, TTS
 * ========================================================================== */

/* ==========================================================================
 * 1. STATE MANAGEMENT
 * ========================================================================== */
let currentVocabList = [];
let deletedHistory = [];
let isMeaningHidden = false;
let activeFilter = null;
let activeDayFilter = null;
let wordStats = {};
let currentMode = 'flashcard';
const TARGET_DAILY_COUNT = 100;
const STORAGE_KEY = 'ebsVoca1800_V1';
const DARK_KEY = 'ebsVoca1800_darkMode';
const STREAK_KEY = 'ebsVoca1800_streak';

/* ==========================================================================
 * 2. INITIALIZATION
 * ========================================================================== */
function initApp() {
    // Restore dark mode
    if (localStorage.getItem(DARK_KEY) === 'true') {
        document.body.classList.add('dark-mode');
        const btn = document.getElementById('darkModeBtn');
        if (btn) btn.innerHTML = '☀️ 라이트';
    }

    // Build day filter buttons
    buildDayFilter();

    const today = new Date().toDateString();
    const savedState = localStorage.getItem(STORAGE_KEY);
    if (savedState) {
        const state = JSON.parse(savedState);
        wordStats = state.wordStats || {};
        if (state.lastDate !== today) {
            updateStreak(state.lastDate);
            fillList(state.currentList || []);
        } else {
            currentVocabList = state.currentList;
        }
    } else {
        fillList([]);
    }
    saveState();
    renderWords();
    updateLevelTitle();
}

function buildDayFilter() {
    const container = document.getElementById('day-filter');
    for (let d = 1; d <= 60; d++) {
        const btn = document.createElement('button');
        btn.id = `btn-day-${d}`;
        btn.className = 'day-btn shrink-0 px-3 py-1.5 rounded-full shadow transition';
        btn.textContent = `D${d}`;
        btn.onclick = () => toggleDayFilter(d);
        container.appendChild(btn);
    }
}

function updateStreak(lastDateStr) {
    const streakData = JSON.parse(localStorage.getItem(STREAK_KEY) || '{"count":0,"lastDate":""}');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (lastDateStr === yesterday.toDateString()) {
        streakData.count++;
    } else if (lastDateStr !== new Date().toDateString()) {
        streakData.count = 1;
    }
    streakData.lastDate = new Date().toDateString();
    localStorage.setItem(STREAK_KEY, JSON.stringify(streakData));
}

/* ==========================================================================
 * 3. SRS FILL LIST (SM-2 Inspired)
 * ========================================================================== */
function fillList(baseList) {
    let newList = [...baseList];
    let needed = TARGET_DAILY_COUNT - newList.length;
    if (needed <= 0) { currentVocabList = newList; return; }

    const now = Date.now();
    // Words due for review (past nextReview)
    const dueWords = masterVocabList.filter(w =>
        wordStats[w.id] && wordStats[w.id].nextReview <= now && !newList.some(nl => nl.id === w.id)
    );
    // New words (never seen)
    const newWords = masterVocabList.filter(w =>
        !wordStats[w.id] && !newList.some(nl => nl.id === w.id)
    );

    const halfNeeded = Math.floor(needed / 2);
    shuffleArray(dueWords);
    newList = [...newList, ...dueWords.slice(0, halfNeeded)];

    const remainingNeeded = TARGET_DAILY_COUNT - newList.length;
    shuffleArray(newWords);
    newList = [...newList, ...newWords.slice(0, remainingNeeded)];

    // If still not enough, pull from any remaining
    if (newList.length < TARGET_DAILY_COUNT) {
        const remaining = masterVocabList.filter(w => !newList.some(nl => nl.id === w.id));
        shuffleArray(remaining);
        newList = [...newList, ...remaining.slice(0, TARGET_DAILY_COUNT - newList.length)];
    }

    shuffleArray(newList);
    currentVocabList = newList;
}

/* ==========================================================================
 * 4. SWIPE HANDLERS (SM-2 Algorithm)
 * ========================================================================== */
function handleSwipeLeft(item) {
    // Know → increase interval (SM-2 style)
    const stat = wordStats[item.id] || { interval: 0, ef: 2.5, reps: 0, nextReview: 0 };
    stat.reps++;
    if (stat.reps === 1) stat.interval = 1;
    else if (stat.reps === 2) stat.interval = 3;
    else stat.interval = Math.round(stat.interval * stat.ef);

    stat.ef = Math.max(1.3, stat.ef + 0.1);
    stat.nextReview = Date.now() + (stat.interval * 24 * 60 * 60 * 1000);
    wordStats[item.id] = stat;
    removeWord(item);
}

function handleSwipeRight(item) {
    // Don't know → reset
    const stat = wordStats[item.id] || { interval: 0, ef: 2.5, reps: 0, nextReview: 0 };
    stat.reps = 0;
    stat.interval = 0;
    stat.ef = Math.max(1.3, stat.ef - 0.2);
    stat.nextReview = Date.now();
    stat.wrongCount = (stat.wrongCount || 0) + 1;
    wordStats[item.id] = stat;
    moveWordToBack(item);
}

/* ==========================================================================
 * 5. STATE PERSISTENCE
 * ========================================================================== */
function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        lastDate: new Date().toDateString(),
        currentList: currentVocabList,
        wordStats: wordStats
    }));
    updateCounts();
    updateUndoButton();
}

/* ==========================================================================
 * 6. CARD RENDERING
 * ========================================================================== */
function renderWords() {
    const container = document.getElementById('word-container');
    container.innerHTML = '';

    let listToRender = getFilteredList();

    if (currentVocabList.length === 0) {
        triggerCelebration();
        setTimeout(() => {
            fillList([]);
            saveState();
            renderWords();
            closeCelebration();
        }, 1500);
        return;
    }

    listToRender.forEach((item, index) => {
        container.appendChild(createCard(item, index));
    });
}

function getFilteredList() {
    let list = currentVocabList;
    if (activeDayFilter) list = list.filter(item => item.day === activeDayFilter);
    if (activeFilter) list = list.filter(item => item.partOfSpeech === activeFilter);
    return list;
}

function createCard(item, index) {
    const card = document.createElement('div');
    card.className = "bg-white p-4 rounded-xl shadow-sm border-l-4 card-touch flex flex-col relative overflow-hidden select-none mb-3";

    const posColors = {
        'Noun': { border: 'border-blue-500', text: 'text-blue-700' },
        'Verb': { border: 'border-red-500', text: 'text-red-700' },
        'Adjective': { border: 'border-green-500', text: 'text-green-700' },
        'Adverb': { border: 'border-amber-500', text: 'text-amber-700' },
        'Preposition': { border: 'border-purple-500', text: 'text-purple-700' },
    };
    const colors = posColors[item.partOfSpeech] || posColors['Noun'];
    card.classList.add(colors.border);

    // Build badges
    let badges = '';
    const root = typeof wordRootData !== 'undefined' && wordRootData[item.id];
    const phrasal = typeof phrasalVerbData !== 'undefined' && phrasalVerbData[item.id];
    const colloc = typeof collocationData !== 'undefined' && collocationData[item.id];
    const family = typeof wordFamilyData !== 'undefined' && wordFamilyData[item.id];
    const confusing = typeof confusingPairData !== 'undefined' && confusingPairData[item.id];

    if (root) badges += `<span class="ml-1 text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold border border-blue-200">🌿 어근</span>`;
    if (phrasal) badges += `<span class="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold border border-amber-200">🔗 구동사</span>`;
    if (colloc) badges += `<span class="ml-1 text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold border border-green-200">🤝 연어</span>`;
    if (family) badges += `<span class="ml-1 text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold border border-purple-200">👨‍👩‍👧 단어가족</span>`;
    if (confusing) badges += `<span class="ml-1 text-[9px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-bold border border-rose-200">⚠️ 혼동주의</span>`;

    // IPA
    const ipaDisplay = item.ipa ? `<span class="card-ipa ipa-text ml-2">${item.ipa}</span>` : '';

    // Day badge
    const dayBadge = `<span class="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-bold">D${item.day}</span>`;

    card.innerHTML = `
        <div class="swipe-hint hint-left font-bold text-red-500 text-xs">알아요 ✅</div>
        <div class="swipe-hint hint-right font-bold text-orange-500 text-xs">몰라요 ❓</div>
        <div class="flex justify-between items-start w-full pointer-events-none mb-1">
            <div class="flex items-center flex-wrap gap-1">
                <span class="font-bold text-xl ${colors.text}">${item.word}</span>
                ${ipaDisplay}
                ${badges}
            </div>
            ${dayBadge}
        </div>
        <div class="flex justify-between items-end w-full pointer-events-none">
            <div class="flex flex-col w-full meaning-container transition-opacity duration-300 ${isMeaningHidden ? '' : 'revealed'}">
                <span class="text-gray-800 font-medium text-lg leading-tight">${item.meaning}</span>
                ${root ? buildRootDisplay(root) : ''}
                ${phrasal ? buildPhrasalDisplay(phrasal) : ''}
                ${colloc ? buildCollocationDisplay(colloc) : ''}
                ${family ? buildFamilyDisplay(family) : ''}
                ${confusing ? buildConfusingDisplay(confusing) : ''}
            </div>
            <button class="speaker-btn pointer-events-auto text-gray-300 hover:text-indigo-600 p-2 transition z-10" onclick="event.stopPropagation(); speak('${item.word.replace(/'/g, "\\'")}')">
                <span class="text-xl">🔊</span>
            </button>
        </div>
    `;
    attachSwipeEvents(card, item, index);
    return card;
}

/* ==========================================================================
 * 7. ENRICHED DATA DISPLAY BUILDERS
 * ========================================================================== */
function buildRootDisplay(root) {
    let partsHtml = '';
    for (let i = 0; i < root.parts.length; i++) {
        if (i > 0) partsHtml += `<span class="root-plus">+</span>`;
        partsHtml += `<span class="root-part"><span class="root-part-word">${root.parts[i]}</span><span class="root-part-meaning">${root.partMeanings[i]}</span></span>`;
    }
    return `<div class="root-etymology mt-1">
        <div class="root-parts">${partsHtml}</div>
        ${root.note ? `<div class="root-note">${root.note}</div>` : ''}
    </div>`;
}

function buildPhrasalDisplay(phrasal) {
    const items = phrasal.verbs.map((v, i) => {
        let html = i > 0 ? '<div class="phrasal-separator"></div>' : '';
        html += `<div class="phrasal-formula"><span class="phrasal-verb">${v.pv}</span></div>`;
        html += `<div class="phrasal-meaning">${v.meaning}</div>`;
        if (v.ex) {
            html += `<div class="phrasal-example">${v.ex}</div>`;
        }
        return html;
    }).join('');
    return `<div class="phrasal-box mt-1">${items}</div>`;
}

function buildCollocationDisplay(colloc) {
    const items = colloc.collocations.map(c => {
        let html = `<div class="collocation-item"><span class="collocation-combo">${c.combo}</span>`;
        if (c.note) html += `<span class="collocation-wrong">${c.note}</span>`;
        html += `</div>`;
        return html;
    }).join('');
    return `<div class="collocation-box mt-1">${items}</div>`;
}

function buildFamilyDisplay(family) {
    const members = family.family.map(m =>
        `<span class="family-member"><span class="family-member-word">${m.word}</span><span class="family-member-pos">${m.pos}</span><span class="family-member-meaning">${m.meaning}</span></span>`
    ).join('');
    return `<div class="family-box mt-1"><div class="family-members">${members}</div></div>`;
}

function buildConfusingDisplay(conf) {
    return conf.pairs.map(p => `
        <div class="confusing-box mt-1">
            <div class="confusing-vs">
                <span class="confusing-word">${p.wordA}</span>
                <span class="confusing-vs-label">VS</span>
                <span class="confusing-word">${p.wordB}</span>
            </div>
            <div class="confusing-explanation">${p.explanationA} / ${p.explanationB}</div>
            ${p.tip ? `<div class="confusing-tip">💡 ${p.tip}</div>` : ''}
        </div>
    `).join('');
}

/* ==========================================================================
 * 8. SWIPE EVENTS & INTERACTIONS
 * ========================================================================== */
function attachSwipeEvents(card, item, index) {
    let startX = 0, currentX = 0, isDragging = false;
    let longPressTimer = null, longPressRevealed = false;

    card.addEventListener('touchstart', e => {
        if (e.target.closest('.speaker-btn')) return;
        startX = e.touches[0].clientX;
        currentX = startX;
        isDragging = true;
        longPressRevealed = false;
        card.style.transition = 'none';
        if (isMeaningHidden) {
            longPressTimer = setTimeout(() => {
                const mc = card.querySelector('.meaning-container');
                if (mc && !mc.classList.contains('revealed')) {
                    mc.classList.add('revealed');
                    longPressRevealed = true;
                    if (navigator.vibrate) navigator.vibrate(30);
                }
            }, 2000);
        }
    }, {passive: true});

    card.addEventListener('touchmove', e => {
        if (!isDragging) return;
        currentX = e.touches[0].clientX;
        const diffX = currentX - startX;
        if (Math.abs(diffX) > 10 && longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        card.style.transform = `translateX(${diffX}px)`;
        card.querySelector('.hint-left').style.opacity = diffX < 0 ? Math.min(-diffX / 100, 1) : 0;
        card.querySelector('.hint-right').style.opacity = diffX > 0 ? Math.min(diffX / 100, 1) : 0;
    }, {passive: true});

    card.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        if (longPressRevealed) {
            const mc = card.querySelector('.meaning-container');
            if (mc) mc.classList.remove('revealed');
            longPressRevealed = false;
            card.style.transition = 'transform 0.3s';
            card.style.transform = 'translateX(0)';
            return;
        }
        const diffX = currentX - startX;
        if (Math.abs(diffX) < 5) toggleCardMeaning(card);
        else if (diffX < -100) { card.style.transform = 'translateX(-120%)'; setTimeout(() => { handleSwipeLeft(item); speakNextWord(); }, 200); }
        else if (diffX > 100) { card.style.transform = 'translateX(120%)'; setTimeout(() => { handleSwipeRight(item); speakNextWord(); }, 200); }
        else { card.style.transition = 'transform 0.3s'; card.style.transform = 'translateX(0)'; }
    });
}

/* ==========================================================================
 * 9. QUIZ MODE
 * ========================================================================== */
let quizWords = [];
let quizIndex = 0;
let quizCorrect = 0;
let quizWrongList = [];

function startQuiz() {
    const pool = activeDayFilter
        ? masterVocabList.filter(w => w.day === activeDayFilter)
        : currentVocabList.length > 0 ? [...currentVocabList] : [...masterVocabList];
    shuffleArray(pool);
    quizWords = pool.slice(0, 10);
    quizIndex = 0;
    quizCorrect = 0;
    quizWrongList = [];
    document.getElementById('quiz-card').classList.remove('hidden');
    document.getElementById('quiz-summary').classList.remove('hidden');
    document.getElementById('quiz-summary').classList.add('hidden');
    document.getElementById('quiz-card').classList.remove('hidden');
    showQuizQuestion();
}

function showQuizQuestion() {
    if (quizIndex >= quizWords.length) { showQuizSummary(); return; }
    const word = quizWords[quizIndex];
    document.getElementById('quiz-current').textContent = quizIndex + 1;
    document.getElementById('quiz-total').textContent = quizWords.length;
    document.getElementById('quiz-bar').style.width = `${((quizIndex) / quizWords.length) * 100}%`;
    document.getElementById('quiz-question').textContent = word.word;
    document.getElementById('quiz-ipa').textContent = word.ipa || '';

    // Generate 4 options (1 correct + 3 wrong)
    const options = [word];
    const pool = masterVocabList.filter(w => w.id !== word.id);
    shuffleArray(pool);
    for (let i = 0; options.length < 4 && i < pool.length; i++) {
        if (!options.some(o => o.meaning === pool[i].meaning)) options.push(pool[i]);
    }
    shuffleArray(options);

    const container = document.getElementById('quiz-options');
    container.innerHTML = '';
    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'quiz-option';
        btn.textContent = opt.meaning;
        btn.onclick = () => checkQuizAnswer(btn, opt.id === word.id, word);
        container.appendChild(btn);
    });

    document.getElementById('quiz-result').classList.add('hidden');
    document.getElementById('quiz-next').classList.add('hidden');
    speak(word.word);
}

function checkQuizAnswer(btn, isCorrect, word) {
    document.querySelectorAll('.quiz-option').forEach(b => b.classList.add('disabled'));
    if (isCorrect) {
        btn.classList.add('correct');
        quizCorrect++;
        document.getElementById('quiz-result').textContent = '정답! 🎉';
        document.getElementById('quiz-result').className = 'mt-4 p-3 rounded-lg text-sm font-bold bg-green-100 text-green-700';
    } else {
        btn.classList.add('wrong');
        document.querySelectorAll('.quiz-option').forEach(b => {
            if (b.textContent === word.meaning) b.classList.add('correct');
        });
        document.getElementById('quiz-result').textContent = `오답! 정답: ${word.meaning}`;
        document.getElementById('quiz-result').className = 'mt-4 p-3 rounded-lg text-sm font-bold bg-red-100 text-red-700';
        quizWrongList.push(word);
        // Track wrong count
        const stat = wordStats[word.id] || { interval: 0, ef: 2.5, reps: 0, nextReview: 0 };
        stat.wrongCount = (stat.wrongCount || 0) + 1;
        wordStats[word.id] = stat;
        saveState();
    }
    document.getElementById('quiz-result').classList.remove('hidden');
    document.getElementById('quiz-next').classList.remove('hidden');
}

function nextQuizQuestion() {
    quizIndex++;
    showQuizQuestion();
}

function showQuizSummary() {
    document.getElementById('quiz-card').classList.add('hidden');
    document.getElementById('quiz-summary').classList.remove('hidden');
    const pct = Math.round((quizCorrect / quizWords.length) * 100);
    document.getElementById('quiz-score').textContent = `${pct}%`;
    const wrongContainer = document.getElementById('quiz-wrong-list');
    wrongContainer.innerHTML = quizWrongList.length === 0
        ? '<p class="text-center text-green-600 font-bold">전부 맞았어요! 🎉</p>'
        : quizWrongList.map(w => `
            <div class="hard-word-item">
                <span class="font-bold">${w.word}</span>
                <span class="text-sm text-gray-500">${w.meaning}</span>
            </div>
        `).join('');
}

/* ==========================================================================
 * 10. DICTATION MODE
 * ========================================================================== */
let dictWords = [];
let dictIndex = 0;
let dictCorrect = 0;
let dictWrongList = [];
let dictHintLevel = 0;

function startDictation() {
    const pool = activeDayFilter
        ? masterVocabList.filter(w => w.day === activeDayFilter)
        : currentVocabList.length > 0 ? [...currentVocabList] : [...masterVocabList];
    shuffleArray(pool);
    dictWords = pool.slice(0, 10);
    dictIndex = 0;
    dictCorrect = 0;
    dictWrongList = [];
    document.getElementById('dict-card').classList.remove('hidden');
    document.getElementById('dict-summary').classList.add('hidden');
    showDictation();
}

function showDictation() {
    if (dictIndex >= dictWords.length) { showDictSummary(); return; }
    dictHintLevel = 0;
    const word = dictWords[dictIndex];
    document.getElementById('dict-current').textContent = dictIndex + 1;
    document.getElementById('dict-total').textContent = dictWords.length;
    document.getElementById('dict-bar').style.width = `${((dictIndex) / dictWords.length) * 100}%`;
    document.getElementById('dict-hint').textContent = '_ '.repeat(word.word.length).trim();
    document.getElementById('dict-input').value = '';
    document.getElementById('dict-result').classList.add('hidden');
    document.getElementById('dict-next').classList.add('hidden');
    document.getElementById('dict-input').disabled = false;
    document.getElementById('dict-input').focus();
    setTimeout(() => playDictationWord(), 300);
}

function playDictationWord() {
    if (dictIndex < dictWords.length) speak(dictWords[dictIndex].word);
}

function showDictHint() {
    const word = dictWords[dictIndex].word;
    dictHintLevel = Math.min(dictHintLevel + 1, word.length);
    let hint = '';
    for (let i = 0; i < word.length; i++) {
        hint += i < dictHintLevel ? word[i] : '_';
        if (i < word.length - 1) hint += ' ';
    }
    document.getElementById('dict-hint').textContent = hint;
}

function checkDictation() {
    const word = dictWords[dictIndex];
    const input = document.getElementById('dict-input').value.trim().toLowerCase();
    const correct = word.word.toLowerCase();
    const resultEl = document.getElementById('dict-result');

    document.getElementById('dict-input').disabled = true;

    if (input === correct) {
        dictCorrect++;
        resultEl.textContent = `정답! 🎉 ${word.meaning}`;
        resultEl.className = 'mt-4 p-3 rounded-lg text-sm font-bold bg-green-100 text-green-700';
    } else {
        resultEl.innerHTML = `오답! 정답: <strong>${word.word}</strong> ${word.ipa || ''}<br>${word.meaning}`;
        resultEl.className = 'mt-4 p-3 rounded-lg text-sm font-bold bg-red-100 text-red-700';
        dictWrongList.push(word);
        const stat = wordStats[word.id] || { interval: 0, ef: 2.5, reps: 0, nextReview: 0 };
        stat.wrongCount = (stat.wrongCount || 0) + 1;
        wordStats[word.id] = stat;
        saveState();
    }
    resultEl.classList.remove('hidden');
    document.getElementById('dict-next').classList.remove('hidden');
    speak(word.word);
}

function nextDictation() {
    dictIndex++;
    showDictation();
}

function showDictSummary() {
    document.getElementById('dict-card').classList.add('hidden');
    document.getElementById('dict-summary').classList.remove('hidden');
    const pct = Math.round((dictCorrect / dictWords.length) * 100);
    document.getElementById('dict-score').textContent = `${pct}%`;
    const wrongContainer = document.getElementById('dict-wrong-list');
    wrongContainer.innerHTML = dictWrongList.length === 0
        ? '<p class="text-center text-green-600 font-bold">전부 맞았어요! 🎉</p>'
        : dictWrongList.map(w => `
            <div class="hard-word-item">
                <span class="font-bold">${w.word} ${w.ipa || ''}</span>
                <span class="text-sm text-gray-500">${w.meaning}</span>
            </div>
        `).join('');
}

/* ==========================================================================
 * 11. STATS DASHBOARD
 * ========================================================================== */
function renderStats() {
    const total = masterVocabList.length;
    const learned = Object.keys(wordStats).filter(id => wordStats[id].reps > 0).length;
    const mastered = Object.keys(wordStats).filter(id => wordStats[id].interval >= 7).length;
    const remaining = total - learned;
    const streakData = JSON.parse(localStorage.getItem(STREAK_KEY) || '{"count":0}');

    document.getElementById('stat-total-learned').textContent = learned;
    document.getElementById('stat-mastered').textContent = mastered;
    document.getElementById('stat-streak').textContent = streakData.count;
    document.getElementById('stat-remaining').textContent = remaining;

    const pct = Math.round((learned / total) * 100);
    const bar = document.getElementById('stat-progress-bar');
    bar.style.width = `${Math.max(pct, 3)}%`;
    document.getElementById('stat-progress-pct').textContent = `${pct}%`;

    // Day grid
    const dayGrid = document.getElementById('stat-day-grid');
    dayGrid.innerHTML = '';
    for (let d = 1; d <= 60; d++) {
        const dayWords = masterVocabList.filter(w => w.day === d);
        const dayLearned = dayWords.filter(w => wordStats[w.id] && wordStats[w.id].reps > 0).length;
        const ratio = dayLearned / dayWords.length;
        let level = 0;
        if (ratio > 0) level = 1;
        if (ratio >= 0.25) level = 2;
        if (ratio >= 0.5) level = 3;
        if (ratio >= 0.75) level = 4;
        if (ratio >= 1) level = 5;

        const cell = document.createElement('div');
        cell.className = `day-cell level-${level}`;
        cell.textContent = d;
        cell.title = `Day ${d}: ${dayLearned}/${dayWords.length}`;
        dayGrid.appendChild(cell);
    }

    // Hard words
    const hardContainer = document.getElementById('stat-hard-words');
    const hardWords = Object.entries(wordStats)
        .filter(([, stat]) => (stat.wrongCount || 0) > 0)
        .sort((a, b) => (b[1].wrongCount || 0) - (a[1].wrongCount || 0))
        .slice(0, 10);

    if (hardWords.length === 0) {
        hardContainer.innerHTML = '<p class="text-center text-gray-400 text-sm">아직 틀린 단어가 없어요!</p>';
    } else {
        hardContainer.innerHTML = hardWords.map(([id, stat]) => {
            const word = masterVocabList.find(w => w.id === parseInt(id));
            if (!word) return '';
            return `<div class="hard-word-item">
                <div>
                    <span class="font-bold text-sm">${word.word}</span>
                    <span class="text-xs text-gray-400 ml-1">${word.ipa || ''}</span>
                </div>
                <span class="text-xs text-red-500 font-bold">${stat.wrongCount}회 오답</span>
            </div>`;
        }).join('');
    }
}

/* ==========================================================================
 * 12. MODE SWITCHING
 * ========================================================================== */
function switchMode(mode) {
    currentMode = mode;
    // Update tabs
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${mode}`).classList.add('active');

    // Show/hide controls
    const flashcardControls = document.getElementById('flashcard-controls');
    const flashcardGuide = document.getElementById('flashcard-guide');
    const dayFilter = document.getElementById('day-filter');
    const posFilter = document.getElementById('pos-filter');

    flashcardControls.classList.toggle('hidden', mode !== 'flashcard');
    flashcardGuide.classList.toggle('hidden', mode !== 'flashcard');
    posFilter.classList.toggle('hidden', mode === 'stats');

    // Show/hide containers
    document.getElementById('word-container').classList.toggle('hidden', mode !== 'flashcard');
    document.getElementById('quiz-container').classList.toggle('hidden', mode !== 'quiz');
    document.getElementById('dictation-container').classList.toggle('hidden', mode !== 'dictation');
    document.getElementById('stats-container').classList.toggle('hidden', mode !== 'stats');

    if (mode === 'quiz') startQuiz();
    if (mode === 'dictation') startDictation();
    if (mode === 'stats') renderStats();
}

/* ==========================================================================
 * 13. FILTER & UI UTILITIES
 * ========================================================================== */
function toggleDayFilter(day) {
    activeDayFilter = activeDayFilter === day ? null : day;
    document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('active'));
    if (activeDayFilter) {
        document.getElementById(`btn-day-${activeDayFilter}`).classList.add('active');
    } else {
        document.getElementById('btn-day-all').classList.add('active');
    }
    renderWords();
    updateCounts();
}

function toggleFilter(pos) {
    activeFilter = activeFilter === pos ? null : pos;
    renderWords();
    updateCounts();
}

function updateCounts() {
    const list = activeDayFilter ? currentVocabList.filter(w => w.day === activeDayFilter) : currentVocabList;
    const counts = { Noun: 0, Verb: 0, Adjective: 0, Adverb: 0 };
    list.forEach(item => { if (counts[item.partOfSpeech] !== undefined) counts[item.partOfSpeech]++; });

    document.getElementById('count-noun').textContent = counts.Noun;
    document.getElementById('count-verb').textContent = counts.Verb;
    document.getElementById('count-adjective').textContent = counts.Adjective;
    document.getElementById('count-adverb').textContent = counts.Adverb;
    document.getElementById('count-total').textContent = list.length;
}

function updateLevelTitle() {
    const el = document.getElementById('level-title');
    if (!el) return;
    if (!currentVocabList.length) { el.textContent = "학습 완료!"; return; }
    if (activeDayFilter) {
        el.textContent = `Day ${activeDayFilter}`;
    } else {
        const days = Array.from(new Set(currentVocabList.map(w => w.day))).sort((a,b) => a-b);
        el.textContent = days.length > 3 ? `EBS VOCA 1800` : `Day ${days.join(', ')}`;
    }
}

function updateUndoButton() {
    const btn = document.getElementById('undoBtn');
    if (btn) btn.classList.toggle('hidden', !deletedHistory.length);
}

function speakNextWord() {
    const list = getFilteredList();
    if (!list.length) return;
    const next = list[0];
    setTimeout(() => {
        window.speechSynthesis.cancel();
        const u1 = new SpeechSynthesisUtterance(next.word);
        u1.lang = 'en-US';
        u1.rate = 0.85;
        const u2 = new SpeechSynthesisUtterance(next.word);
        u2.lang = 'en-US';
        u2.rate = 0.85;
        window.speechSynthesis.speak(u1);
        window.speechSynthesis.speak(u2);
    }, 300);
}

function removeWord(item) {
    const idx = currentVocabList.indexOf(item);
    if (idx > -1) { deletedHistory.push(item); currentVocabList.splice(idx, 1); renderWords(); saveState(); }
}

function moveWordToBack(item) {
    const idx = currentVocabList.indexOf(item);
    if (idx > -1) { currentVocabList.push(currentVocabList.splice(idx, 1)[0]); renderWords(); saveState(); }
}

function undoDelete() {
    if (deletedHistory.length) { currentVocabList.unshift(deletedHistory.pop()); renderWords(); saveState(); }
}

function toggleMeanings() {
    isMeaningHidden = !isMeaningHidden;
    const btn = document.getElementById('toggleBtn');
    btn.innerText = isMeaningHidden ? "👁️ 뜻 보이기" : "👁️ 뜻 가리기";
    btn.classList.toggle('bg-indigo-600'); btn.classList.toggle('bg-gray-500');
    document.body.classList.toggle('hide-meaning', isMeaningHidden);
    if (!isMeaningHidden) document.querySelectorAll('.revealed').forEach(el => el.classList.remove('revealed'));
}

function toggleCardMeaning(card) {
    if (isMeaningHidden) card.querySelector('.meaning-container').classList.toggle('revealed');
}

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function shuffleCurrentList() { shuffleArray(currentVocabList); renderWords(); }

function resetList() {
    if (confirm('초기화하시겠습니까? 모든 학습 기록이 삭제됩니다.')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STREAK_KEY);
        location.reload();
    }
}

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem(DARK_KEY, isDark);
    const btn = document.getElementById('darkModeBtn');
    if (btn) btn.innerHTML = isDark ? '☀️ 라이트' : '🌙 다크';
}

/* ==========================================================================
 * 14. TEXT-TO-SPEECH (English)
 * ========================================================================== */
function speak(text) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'en-US';
        u.rate = 0.85;
        window.speechSynthesis.speak(u);
    }
}

/* ==========================================================================
 * 15. CELEBRATION
 * ========================================================================== */
function triggerCelebration() {
    const ov = document.getElementById('celebration-overlay');
    if (ov) ov.classList.add('active');
    const au = document.getElementById('applause-sound');
    if (au) au.play().catch(() => {});
}

function closeCelebration() {
    const ov = document.getElementById('celebration-overlay');
    if (ov) ov.classList.remove('active');
}

/* ==========================================================================
 * 16. START
 * ========================================================================== */
initApp();
