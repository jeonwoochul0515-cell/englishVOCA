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
const CUSTOM_WORDS_KEY = 'ebsVoca1800_customWords';
const DICT_CACHE_KEY = 'ebsVoca1800_dictCache';
let customWords = [];
let dictCache = {};

// Ebbinghaus forgetting curve intervals (days)
const EBBINGHAUS = [1, 3, 7, 14, 30, 60];

/* ==========================================================================
 * 2. INITIALIZATION
 * ========================================================================== */
function initApp() {
    // Load custom words and dictionary cache
    loadCustomWords();
    loadDictCache();

    // Clean up old V2 key if exists (merge back to V1)
    const v2Data = localStorage.getItem('ebsVoca1800_V2');
    if (v2Data) {
        localStorage.setItem(STORAGE_KEY, v2Data);
        localStorage.removeItem('ebsVoca1800_V2');
    }

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

        // Migrate old SM-2 stats to Ebbinghaus if needed
        const rawStats = state.wordStats || {};
        wordStats = {};
        Object.entries(rawStats).forEach(([id, stat]) => {
            if (stat.level !== undefined) {
                wordStats[id] = stat;
            } else {
                wordStats[id] = {
                    level: stat.reps || 0,
                    nextReview: stat.nextReview || 0,
                    wrongCount: stat.wrongCount || 0,
                    lastSeen: Date.now()
                };
            }
        });

        // Read saved list (handle both old object format and new ID format)
        let savedIds = [];
        if (state.currentListIds && state.currentListIds.length > 0) {
            savedIds = state.currentListIds;
        } else if (state.currentList && state.currentList.length > 0) {
            savedIds = state.currentList.map(w => w.id).filter(Boolean);
        }

        if (state.lastDate === today && savedIds.length > 0) {
            // Same day → restore list from saved IDs
            currentVocabList = idsToWords(savedIds);
            // Safety: remove words already known but not yet due for review
            const now = Date.now();
            currentVocabList = currentVocabList.filter(w => {
                const stat = wordStats[w.id];
                if (!stat || stat.level === 0) return true;
                return stat.nextReview <= now;
            });
        } else {
            // New day → build fresh list
            if (state.lastDate !== today) updateStreak(state.lastDate);
            fillList();
        }
    } else {
        fillList();
    }

    saveState();
    renderWords();
    updateLevelTitle();
}

// Convert array of word IDs back to word objects from masterVocabList + customWords
function idsToWords(ids) {
    const map = {};
    masterVocabList.forEach(w => map[w.id] = w);
    customWords.forEach(w => map[w.id] = w);
    return ids.map(id => map[id]).filter(Boolean);
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
 * 3. SRS FILL LIST (Ebbinghaus Forgetting Curve)
 * ========================================================================== */
function fillList() {
    const now = Date.now();
    const allWords = [...masterVocabList, ...customWords];

    // Review words: previously learned, now due for review
    const reviewWords = allWords.filter(w => {
        const stat = wordStats[w.id];
        return stat && stat.level > 0 && stat.nextReview <= now;
    });

    // New words: never seen before
    const newWords = allWords.filter(w => {
        return !wordStats[w.id] || wordStats[w.id].level === 0;
    });

    shuffleArray(reviewWords);
    shuffleArray(newWords);

    // Target: ~50% review, ~50% new
    const halfTarget = Math.floor(TARGET_DAILY_COUNT / 2);
    let list = [];

    // Take review words (up to half)
    list = list.concat(reviewWords.slice(0, halfTarget));

    // Fill rest with new words
    const newNeeded = TARGET_DAILY_COUNT - list.length;
    list = list.concat(newWords.slice(0, newNeeded));

    // If still not enough, pull from any remaining words
    if (list.length < TARGET_DAILY_COUNT) {
        const usedIds = new Set(list.map(w => w.id));
        const remaining = allWords.filter(w => !usedIds.has(w.id));
        shuffleArray(remaining);
        list = list.concat(remaining.slice(0, TARGET_DAILY_COUNT - list.length));
    }

    shuffleArray(list);
    currentVocabList = list;
}

/* ==========================================================================
 * 4. SWIPE HANDLERS (Ebbinghaus Forgetting Curve)
 * ========================================================================== */
function handleSwipeLeft(item) {
    // Know → advance Ebbinghaus level
    const stat = wordStats[item.id] || { level: 0, nextReview: 0, wrongCount: 0 };
    stat.level = Math.min((stat.level || 0) + 1, EBBINGHAUS.length);
    const days = stat.level >= EBBINGHAUS.length ? 90 : EBBINGHAUS[stat.level - 1];
    stat.nextReview = Date.now() + (days * 24 * 60 * 60 * 1000);
    stat.lastSeen = Date.now();
    wordStats[item.id] = stat;
    removeWord(item);
}

function handleSwipeRight(item) {
    // Don't know → reset level, move to back
    const stat = wordStats[item.id] || { level: 0, nextReview: 0, wrongCount: 0 };
    stat.level = 0;
    stat.nextReview = Date.now();
    stat.lastSeen = Date.now();
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
        currentListIds: currentVocabList.map(w => w.id),
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
            fillList();
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

    if (root) badges += `<span class="ml-1 text-[11px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold border border-blue-200">🌿 어근</span>`;
    if (phrasal) badges += `<span class="ml-1 text-[11px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold border border-amber-200">🔗 구동사</span>`;
    if (colloc) badges += `<span class="ml-1 text-[11px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold border border-green-200">🤝 연어</span>`;
    if (family) badges += `<span class="ml-1 text-[11px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold border border-purple-200">👨‍👩‍👧 단어가족</span>`;
    if (confusing) badges += `<span class="ml-1 text-[11px] bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded font-bold border border-rose-200">⚠️ 혼동주의</span>`;

    // IPA
    const ipaDisplay = item.ipa ? `<span class="card-ipa ipa-text ml-2">${item.ipa}</span>` : '';

    // Day badge
    const dayBadge = item.isCustom
        ? `<span class="text-[12px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-bold">내 단어</span>`
        : `<span class="text-[12px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-bold">D${item.day}</span>`;

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
            <div class="flex flex-col items-center gap-1 pointer-events-auto z-10">
                <button class="speaker-btn text-gray-300 hover:text-indigo-600 p-1 transition" onclick="event.stopPropagation(); speak('${item.word.replace(/'/g, "\\'")}')">
                    <span class="text-xl">🔊</span>
                </button>
            </div>
        </div>
    `;
    attachSwipeEvents(card, item, index);
    return card;
}

/* ==========================================================================
 * 7. ENRICHED DATA DISPLAY BUILDERS
 * ========================================================================== */
function buildRootDisplay(root) {
    if (!root || !root.parts) return '';
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
    if (!phrasal || !phrasal.verbs) return '';
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
    if (!colloc || !colloc.collocations) return '';
    const items = colloc.collocations.map(c => {
        let html = `<div class="collocation-item"><span class="collocation-combo">${c.combo}</span>`;
        if (c.note) html += `<span class="collocation-wrong">${c.note}</span>`;
        html += `</div>`;
        return html;
    }).join('');
    return `<div class="collocation-box mt-1">${items}</div>`;
}

function buildFamilyDisplay(family) {
    if (!family || !family.family) return '';
    const members = family.family.map(m =>
        `<span class="family-member"><span class="family-member-word">${m.word}</span><span class="family-member-pos">${m.pos}</span><span class="family-member-meaning">${m.meaning}</span></span>`
    ).join('');
    return `<div class="family-box mt-1"><div class="family-members">${members}</div></div>`;
}

function buildConfusingDisplay(conf) {
    if (!conf || !conf.pairs) return '';
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

    function onStart(x, e) {
        if (e && e.target.closest('.speaker-btn')) return;
        startX = x;
        currentX = x;
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
    }

    function onMove(x) {
        if (!isDragging) return;
        currentX = x;
        const diffX = currentX - startX;
        if (Math.abs(diffX) > 10 && longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
        card.style.transform = `translateX(${diffX}px)`;
        card.querySelector('.hint-left').style.opacity = diffX < 0 ? Math.min(-diffX / 100, 1) : 0;
        card.querySelector('.hint-right').style.opacity = diffX > 0 ? Math.min(diffX / 100, 1) : 0;
    }

    function onEnd() {
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
        if (Math.abs(diffX) < 5) {
            toggleCardMeaning(card);
        } else if (diffX < -100) {
            const filtered = getFilteredList();
            const nextWord = filtered[filtered.indexOf(item) + 1];
            if (nextWord) speak(nextWord.word);
            card.style.transform = 'translateX(-120%)';
            setTimeout(() => handleSwipeLeft(item), 200);
        } else if (diffX > 100) {
            const filtered = getFilteredList();
            const nextWord = filtered[filtered.indexOf(item) + 1];
            if (nextWord) speak(nextWord.word);
            card.style.transform = 'translateX(120%)';
            setTimeout(() => handleSwipeRight(item), 200);
        } else {
            card.style.transition = 'transform 0.3s';
            card.style.transform = 'translateX(0)';
        }
    }

    // Touch events (모바일)
    card.addEventListener('touchstart', e => onStart(e.touches[0].clientX, e), {passive: true});
    card.addEventListener('touchmove', e => onMove(e.touches[0].clientX), {passive: true});
    card.addEventListener('touchend', onEnd);

    // Mouse events (PC)
    card.addEventListener('mousedown', e => { e.preventDefault(); onStart(e.clientX, e); });
    card.addEventListener('mousemove', e => { if (isDragging) onMove(e.clientX); });
    card.addEventListener('mouseup', onEnd);
    card.addEventListener('mouseleave', () => { if (isDragging) onEnd(); });
}

/* ==========================================================================
 * 9. QUIZ MODE
 * ========================================================================== */
let quizWords = [];
let quizIndex = 0;
let quizCorrect = 0;
let quizWrongList = [];

function startQuiz() {
    const allWords = [...masterVocabList, ...customWords];
    const pool = activeDayFilter
        ? allWords.filter(w => w.day === activeDayFilter)
        : currentVocabList.length > 0 ? [...currentVocabList] : allWords;
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
    const pool = [...masterVocabList, ...customWords].filter(w => w.id !== word.id);
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
        document.getElementById('quiz-result').classList.remove('hidden');
        // 정답이면 0.7초 후 자동으로 다음 문제
        setTimeout(() => { quizIndex++; showQuizQuestion(); }, 700);
        return;
    } else {
        btn.classList.add('wrong');
        document.querySelectorAll('.quiz-option').forEach(b => {
            if (b.textContent === word.meaning) b.classList.add('correct');
        });
        document.getElementById('quiz-result').textContent = `오답! 정답: ${word.meaning}`;
        document.getElementById('quiz-result').className = 'mt-4 p-3 rounded-lg text-sm font-bold bg-red-100 text-red-700';
        quizWrongList.push(word);
        const stat = wordStats[word.id] || { level: 0, nextReview: 0, wrongCount: 0 };
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
    const allWords = [...masterVocabList, ...customWords];
    const pool = activeDayFilter
        ? allWords.filter(w => w.day === activeDayFilter)
        : currentVocabList.length > 0 ? [...currentVocabList] : allWords;
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
        const stat = wordStats[word.id] || { level: 0, nextReview: 0, wrongCount: 0 };
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
    const masterIds = new Set(masterVocabList.map(w => String(w.id)));
    const total = masterVocabList.length;
    const learned = Object.keys(wordStats).filter(id => masterIds.has(id) && (wordStats[id].level || 0) > 0).length;
    const mastered = Object.keys(wordStats).filter(id => masterIds.has(id) && (wordStats[id].level || 0) >= EBBINGHAUS.length).length;
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
        const dayLearned = dayWords.filter(w => wordStats[w.id] && (wordStats[w.id].level || 0) > 0).length;
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
            const word = masterVocabList.find(w => w.id === parseInt(id)) || customWords.find(w => w.id === id);
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
 * 12. DICTIONARY & CUSTOM WORDS
 * ========================================================================== */
function loadCustomWords() {
    const saved = localStorage.getItem(CUSTOM_WORDS_KEY);
    customWords = saved ? JSON.parse(saved) : [];
}

function saveCustomWords() {
    localStorage.setItem(CUSTOM_WORDS_KEY, JSON.stringify(customWords));
}

function loadDictCache() {
    const saved = localStorage.getItem(DICT_CACHE_KEY);
    dictCache = saved ? JSON.parse(saved) : {};
}

function saveDictCache() {
    localStorage.setItem(DICT_CACHE_KEY, JSON.stringify(dictCache));
}

async function searchDictionary() {
    const input = document.getElementById('dict-search-input');
    const query = input.value.trim().toLowerCase();
    if (!query) return;

    const resultsContainer = document.getElementById('dict-search-results');

    // Find in EBS 1800
    const exactMaster = masterVocabList.find(w => w.word.toLowerCase() === query);
    const partialMasters = masterVocabList.filter(w =>
        w.word.toLowerCase().startsWith(query) && w.word.toLowerCase() !== query
    ).slice(0, 10);

    // Find in offline dictionary
    const offlineDictEntry = (typeof offlineDict !== 'undefined') ? offlineDict[query] : null;
    const offlinePartials = (typeof offlineDict !== 'undefined')
        ? Object.keys(offlineDict).filter(w => w.startsWith(query) && w !== query && !partialMasters.some(m => m.word.toLowerCase() === w)).slice(0, 10)
        : [];

    // Check if already in custom words
    const exactCustom = customWords.find(w => w.word.toLowerCase() === query);

    // Check cache
    let apiData = dictCache[query] || null;

    // Show immediate local results
    renderDictSearchResults(query, exactMaster, partialMasters, exactCustom, apiData, offlineDictEntry, offlinePartials);

    // Try API for richer data if not cached (non-blocking)
    if (!apiData) {
        try {
            const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`);
            if (response.ok) {
                apiData = await response.json();
                dictCache[query] = apiData;
                saveDictCache();
                renderDictSearchResults(query, exactMaster, partialMasters, exactCustom, apiData, offlineDictEntry, offlinePartials);
            }
        } catch (e) {
            // Offline - local results already shown
        }
    }
}

function renderDictSearchResults(query, exactMaster, partialMasters, exactCustom, apiData, offlineDictEntry, offlinePartials) {
    const container = document.getElementById('dict-search-results');
    let html = '';
    let wordFound = false;

    // 1. API / Cache result card (richest data)
    if (apiData && apiData.length > 0) {
        const entry = apiData[0];
        const word = entry.word;
        const phonetic = entry.phonetic || (entry.phonetics && entry.phonetics.find(p => p.text) || {}).text || '';

        let meaningsHtml = '';
        entry.meanings.forEach(m => {
            meaningsHtml += `<div class="dict-pos">${m.partOfSpeech}</div>`;
            m.definitions.slice(0, 3).forEach(d => {
                meaningsHtml += `<div class="dict-def">${d.definition}</div>`;
                if (d.example) meaningsHtml += `<div class="dict-example">"${d.example}"</div>`;
            });
        });

        // Korean meaning from offline dict
        const korMeaning = offlineDictEntry || (exactMaster ? exactMaster.meaning : '');

        html += `<div class="dict-result-card">
            <div class="dict-word-header">
                <span class="dict-word">${word}</span>
                <span class="dict-phonetic">${phonetic}</span>
                <button onclick="speak('${word.replace(/'/g, "\\'")}')" class="text-xl ml-2">🔊</button>
            </div>
            ${korMeaning ? `<div style="font-size:16px;font-weight:700;color:#4f46e5;margin-bottom:6px;">${korMeaning}</div>` : ''}
            ${meaningsHtml}`;

        if (exactMaster) {
            html += `<div class="dict-badge-master">📘 EBS 1800 수록 (D${exactMaster.day})</div>`;
        }

        if (!exactMaster && !exactCustom) {
            const firstPos = entry.meanings[0] ? entry.meanings[0].partOfSpeech : '';
            const prefill = offlineDictEntry ? offlineDictEntry.replace(/"/g, '&quot;') : '';
            html += `<div class="dict-add-section">
                <input type="text" id="dict-custom-meaning" class="dict-meaning-input" placeholder="한국어 뜻 입력 (예: n. 뜻밖의 발견)" value="${prefill}">
                <button onclick="addCustomWordFromSearch('${word.replace(/'/g, "\\'")}', '${phonetic.replace(/'/g, "\\'")}', '${firstPos}')" class="dict-add-btn">
                    ➕ 학습 목록에 추가
                </button>
            </div>`;
        } else if (exactCustom) {
            html += `<div class="dict-badge-added">✅ 내 단어장에 추가됨 — ${exactCustom.meaning}</div>`;
        }

        html += `</div>`;
        wordFound = true;

    // 2. Offline dictionary entry (no API data)
    } else if (offlineDictEntry) {
        html += `<div class="dict-result-card">
            <div class="dict-word-header">
                <span class="dict-word">${query}</span>
                <button onclick="speak('${query.replace(/'/g, "\\'")}')" class="text-xl ml-2">🔊</button>
            </div>
            <div style="font-size:17px;font-weight:700;color:#1e293b;margin:4px 0;">${offlineDictEntry}</div>`;

        if (exactMaster) {
            html += `<div class="dict-badge-master">📘 EBS 1800 수록 (D${exactMaster.day}) — ${exactMaster.meaning}</div>`;
        }

        if (!exactMaster && !exactCustom) {
            const prefill = offlineDictEntry.replace(/"/g, '&quot;');
            html += `<div class="dict-add-section">
                <input type="text" id="dict-custom-meaning" class="dict-meaning-input" placeholder="한국어 뜻 입력" value="${prefill}">
                <button onclick="addCustomWordFromSearch('${query.replace(/'/g, "\\'")}', '', '')" class="dict-add-btn">
                    ➕ 학습 목록에 추가
                </button>
            </div>`;
        } else if (exactCustom) {
            html += `<div class="dict-badge-added">✅ 내 단어장에 추가됨 — ${exactCustom.meaning}</div>`;
        }

        html += `</div>`;
        wordFound = true;

    // 3. EBS master word only
    } else if (exactMaster) {
        html += `<div class="dict-result-card">
            <div class="dict-word-header">
                <span class="dict-word">${exactMaster.word}</span>
                <span class="dict-phonetic">${exactMaster.ipa || ''}</span>
                <button onclick="speak('${exactMaster.word.replace(/'/g, "\\'")}')" class="text-xl ml-2">🔊</button>
            </div>
            <div style="font-size:17px;font-weight:700;color:#1e293b;margin:4px 0;">${exactMaster.meaning}</div>
            <div class="dict-badge-master">📘 EBS 1800 수록 (D${exactMaster.day})</div>
        </div>`;
        wordFound = true;
    }

    // 4. Not found anywhere
    if (!wordFound) {
        html += `<div class="dict-offline-notice">
            😕 "${query}" — 사전에 없는 단어입니다.<br>
            아래 "직접 추가"에서 수동으로 추가할 수 있습니다.
        </div>`;
    }

    // 5. Partial matches from EBS 1800
    if (partialMasters.length > 0) {
        html += `<div class="dict-master-matches">
            <div class="text-xs font-bold text-gray-500 mb-2 mt-3">📘 EBS 1800 관련 단어</div>`;
        partialMasters.forEach(w => {
            html += `<div class="dict-master-item" onclick="document.getElementById('dict-search-input').value='${w.word}'; searchDictionary();">
                <div>
                    <span class="font-bold text-sm">${w.word}</span>
                    <span class="text-xs text-gray-400 ml-1">${w.ipa || ''}</span>
                </div>
                <span class="text-xs text-gray-500">${w.meaning}</span>
            </div>`;
        });
        html += `</div>`;
    }

    // 6. Partial matches from offline dictionary
    if (offlinePartials && offlinePartials.length > 0) {
        html += `<div class="dict-master-matches">
            <div class="text-xs font-bold text-gray-500 mb-2 mt-3">📖 사전 관련 단어</div>`;
        offlinePartials.forEach(w => {
            html += `<div class="dict-master-item" onclick="document.getElementById('dict-search-input').value='${w}'; searchDictionary();">
                <div><span class="font-bold text-sm">${w}</span></div>
                <span class="text-xs text-gray-500">${offlineDict[w]}</span>
            </div>`;
        });
        html += `</div>`;
    }

    container.innerHTML = html;
}

function addCustomWordFromSearch(word, ipa, apiPos) {
    const meaningInput = document.getElementById('dict-custom-meaning');
    const meaning = meaningInput ? meaningInput.value.trim() : '';

    if (!meaning) {
        showToast('한국어 뜻을 입력해주세요');
        if (meaningInput) meaningInput.focus();
        return;
    }

    // Determine part of speech
    let pos = 'Noun';
    if (meaning.match(/^(v\.|동)/)) pos = 'Verb';
    else if (meaning.match(/^(a\.|형)/)) pos = 'Adjective';
    else if (meaning.match(/^(ad\.|부)/)) pos = 'Adverb';
    else if (apiPos) {
        const posMap = { noun: 'Noun', verb: 'Verb', adjective: 'Adjective', adverb: 'Adverb' };
        pos = posMap[apiPos.toLowerCase()] || 'Noun';
    }

    const newWord = {
        id: 'c_' + Date.now(),
        word: word,
        meaning: meaning,
        partOfSpeech: pos,
        day: 'custom',
        ipa: ipa || '',
        isCustom: true
    };

    // Check duplicate
    if (customWords.some(w => w.word.toLowerCase() === word.toLowerCase())) {
        showToast('이미 내 단어장에 있는 단어입니다');
        return;
    }

    customWords.push(newWord);
    saveCustomWords();

    // Add to today's study list
    currentVocabList.push(newWord);
    saveState();

    showToast(`"${word}" 학습 목록에 추가됨!`);
    renderCustomWordsList();

    // Refresh search to show "added" badge
    searchDictionary();
}

function addManualWord() {
    const wordInput = document.getElementById('manual-word');
    const meaningInput = document.getElementById('manual-meaning');
    const word = wordInput.value.trim();
    const meaning = meaningInput.value.trim();

    if (!word) { showToast('영어 단어를 입력해주세요'); wordInput.focus(); return; }
    if (!meaning) { showToast('뜻을 입력해주세요'); meaningInput.focus(); return; }

    // Check duplicate in master list
    if (masterVocabList.some(w => w.word.toLowerCase() === word.toLowerCase())) {
        showToast('EBS 1800에 이미 있는 단어입니다');
        return;
    }

    // Check duplicate in custom words
    if (customWords.some(w => w.word.toLowerCase() === word.toLowerCase())) {
        showToast('이미 내 단어장에 있는 단어입니다');
        return;
    }

    let pos = 'Noun';
    if (meaning.match(/^(v\.|동)/)) pos = 'Verb';
    else if (meaning.match(/^(a\.|형)/)) pos = 'Adjective';
    else if (meaning.match(/^(ad\.|부)/)) pos = 'Adverb';

    const newWord = {
        id: 'c_' + Date.now(),
        word: word,
        meaning: meaning,
        partOfSpeech: pos,
        day: 'custom',
        ipa: '',
        isCustom: true
    };

    customWords.push(newWord);
    saveCustomWords();

    currentVocabList.push(newWord);
    saveState();

    wordInput.value = '';
    meaningInput.value = '';

    showToast(`"${word}" 학습 목록에 추가됨!`);
    renderCustomWordsList();
}

function removeCustomWord(id) {
    const word = customWords.find(w => w.id === id);
    if (!word) return;
    if (!confirm(`"${word.word}"를 내 단어장에서 삭제하시겠습니까?`)) return;

    customWords = customWords.filter(w => w.id !== id);
    saveCustomWords();

    currentVocabList = currentVocabList.filter(w => w.id !== id);
    delete wordStats[id];
    saveState();

    renderCustomWordsList();
    showToast(`"${word.word}" 삭제됨`);
}

function renderCustomWordsList() {
    const container = document.getElementById('custom-words-list');
    const countEl = document.getElementById('custom-count');
    if (!container) return;

    countEl.textContent = `(${customWords.length}개)`;

    if (customWords.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 text-sm py-4">아직 추가한 단어가 없습니다.<br>위에서 단어를 검색하거나 직접 추가해보세요!</p>';
        return;
    }

    container.innerHTML = customWords.map(w => {
        const stat = wordStats[w.id] || { level: 0, wrongCount: 0 };
        const levelText = stat.level > 0 ? `Lv.${stat.level}` : '새 단어';
        const levelColor = stat.level > 0 ? 'text-indigo-600' : 'text-gray-400';
        return `<div class="custom-word-item">
            <div style="flex:1;min-width:0;">
                <span class="font-bold text-sm">${w.word}</span>
                <span class="text-xs text-gray-400 ml-1">${w.ipa || ''}</span>
                <br><span class="text-xs text-gray-600">${w.meaning}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <span class="text-[10px] ${levelColor} font-bold">${levelText}</span>
                <button class="delete-btn" onclick="removeCustomWord('${w.id}')">✕</button>
            </div>
        </div>`;
    }).join('');
}

/* ==========================================================================
 * 13. MODE SWITCHING
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
    posFilter.classList.toggle('hidden', mode === 'stats' || mode === 'dictionary');

    // Show/hide containers
    document.getElementById('word-container').classList.toggle('hidden', mode !== 'flashcard');
    document.getElementById('quiz-container').classList.toggle('hidden', mode !== 'quiz');
    document.getElementById('dictation-container').classList.toggle('hidden', mode !== 'dictation');
    document.getElementById('stats-container').classList.toggle('hidden', mode !== 'stats');
    document.getElementById('dictionary-container').classList.toggle('hidden', mode !== 'dictionary');

    // 플로팅 사전 버튼: 사전 모드에서는 숨김
    const fab = document.getElementById('fab-dict');
    if (fab) fab.classList.toggle('hidden', mode === 'dictionary');

    if (mode === 'quiz') startQuiz();
    if (mode === 'dictation') startDictation();
    if (mode === 'stats') renderStats();
    if (mode === 'dictionary') {
        renderCustomWordsList();
        setTimeout(() => document.getElementById('dict-search-input').focus(), 100);
    }
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
        el.textContent = `오늘의 단어 ${currentVocabList.length}개`;
    }
}

function updateUndoButton() {
    const btn = document.getElementById('undoBtn');
    if (btn) btn.classList.toggle('hidden', !deletedHistory.length);
}


function removeWord(item) {
    const idx = currentVocabList.findIndex(w => w.id === item.id);
    if (idx > -1) {
        const word = currentVocabList[idx];
        deletedHistory.push(word);
        currentVocabList.splice(idx, 1);
        saveState();
        renderWords();
        showToast(`"${word.word}" 외움 처리 (남은 ${currentVocabList.length}개)`);
    }
}

function moveWordToBack(item) {
    const idx = currentVocabList.findIndex(w => w.id === item.id);
    if (idx > -1) {
        const word = currentVocabList.splice(idx, 1)[0];
        currentVocabList.push(word);
        saveState();
        renderWords();
        showToast(`"${word.word}" → 맨 뒤로 이동 (남은 ${currentVocabList.length}개)`);
    }
}

function showToast(msg) {
    let toast = document.getElementById('toast-msg');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-msg';
        toast.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 16px;border-radius:20px;font-size:13px;font-weight:bold;z-index:9999;opacity:0;transition:opacity 0.3s;white-space:nowrap;';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 1500);
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
    document.querySelectorAll('.meaning-container').forEach(el => {
        if (isMeaningHidden) el.classList.remove('revealed');
        else el.classList.add('revealed');
    });
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
