/* * ==========================================================================
 * 1. DATA SECTION (Master Vocabulary List)
 * ========================================================================== */
// masterVocabList는 vocab.js에서 정의됨

/* * ==========================================================================
 * 2. STATE MANAGEMENT & INITIALIZATION
 * ========================================================================== */
let currentVocabList = [];
let deletedHistory = [];
let isMeaningHidden = false;
let activeFilter = null; 
let wordStats = {}; 
const TARGET_DAILY_COUNT = 100;

function initApp() {
    // 다크모드 복원
    if (localStorage.getItem('germanVocab_darkMode') === 'true') {
        document.body.classList.add('dark-mode');
        const btn = document.getElementById('darkModeBtn');
        if (btn) btn.innerHTML = '☀️ 라이트';
    }

    const today = new Date().toDateString();
    const savedState = localStorage.getItem('germanVocabState_V5'); // 버전을 V5로 업데이트
    if (savedState) {
        const state = JSON.parse(savedState);
        wordStats = state.wordStats || {};
        if (state.lastDate !== today) {
            console.log("🌞 밤 12시 셋업: 리스트를 새로 갱신합니다.");
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

/**
 * 50:50 추천 로직 구현
 */
function fillList(baseList) {
    let newList = [...baseList];
    const needed = TARGET_DAILY_COUNT - newList.length;
    if (needed <= 0) {
        currentVocabList = newList;
        return;
    }

    // 1) 이미 배운 단어 (복습 대상)
    const learnedWords = masterVocabList.filter(w => wordStats[w.id] && !newList.some(nl => nl.id === w.id));
    // 2) 한 번도 안 배운 단어 (새 단어)
    const newWords = masterVocabList.filter(w => !wordStats[w.id] && !newList.some(nl => nl.id === w.id));

    const halfNeeded = Math.floor(needed / 2);
    
    // 복습 단어 추가 (50%)
    shuffleArray(learnedWords);
    newList = [...newList, ...learnedWords.slice(0, halfNeeded)];

    // 새 단어 추가 (나머지 전부)
    const remainingNeeded = TARGET_DAILY_COUNT - newList.length;
    shuffleArray(newWords);
    newList = [...newList, ...newWords.slice(0, remainingNeeded)];

    // 단어장 고갈 시 대비
    if (newList.length < TARGET_DAILY_COUNT) {
        const remainingAll = masterVocabList.filter(w => !newList.some(nl => nl.id === w.id));
        shuffleArray(remainingAll);
        newList = [...newList, ...remainingAll.slice(0, TARGET_DAILY_COUNT - newList.length)];
    }

    shuffleArray(newList);
    currentVocabList = newList;
}

/* * ==========================================================================
 * 3. CORE LOGIC (SRS & RENDERING)
 * ========================================================================== */
function handleSwipeLeft(item) {
    // 알아요 -> 간격 증가
    const stat = wordStats[item.id] || { interval: 0, nextReview: 0 };
    let newInterval = stat.interval === 0 ? 1 : stat.interval * 2;
    wordStats[item.id] = { 
        interval: newInterval, 
        nextReview: Date.now() + (newInterval * 24 * 60 * 60 * 1000) 
    };
    removeWord(item);
}

function handleSwipeRight(item) {
    // 몰라요 -> 오늘 재학습
    wordStats[item.id] = { interval: 0, nextReview: Date.now() };
    moveWordToBack(item);
}

function saveState() {
    localStorage.setItem('germanVocabState_V5', JSON.stringify({
        lastDate: new Date().toDateString(),
        currentList: currentVocabList,
        wordStats: wordStats
    }));
    updateCounts();
    updateUndoButton();
}

function renderWords() {
    const container = document.getElementById('word-container');
    container.innerHTML = '';
    
    let listToRender = activeFilter ? currentVocabList.filter(item => item.partOfSpeech === activeFilter) : currentVocabList;

    if (currentVocabList.length === 0) {
        triggerCelebration();
        setTimeout(() => {
            console.log("🔄 모든 단어 학습 완료: 새로운 100개를 충전합니다.");
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

function createCard(item, index) {
    const card = document.createElement('div');
    card.className = "bg-white p-4 rounded-xl shadow-sm border-l-4 card-touch flex flex-col relative overflow-hidden select-none mb-3";
    
    let borderColor = item.partOfSpeech === 'Noun' ? "border-blue-500" : item.partOfSpeech === 'Verb' ? "border-red-500" : "border-green-500";
    let textColor = item.partOfSpeech === 'Noun' ? "text-blue-700" : item.partOfSpeech === 'Verb' ? "text-red-700" : "text-green-700";
    let mainText = item.partOfSpeech === 'Noun' ? `${item.gender.charAt(0).toUpperCase() + item.gender.slice(1)} ${item.word}` : item.word;
    card.classList.add(borderColor);

    // 배지 생성 (다의어, 동일어원, 결합어)
    let cognateBadge = item.cognate ? `<span class="ml-1 text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold border border-indigo-200">🌱 동일어원</span>` : '';
    let polysemyBadge = item.polysemy ? `<span class="ml-1 text-[9px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold border border-orange-200">📚 다의어</span>` : '';
    const compound = compoundData[item.id];
    let compoundBadge = compound ? `<span class="ml-1 text-[9px] bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded font-bold border border-pink-200">🔗 결합어</span>` : '';
    const rektion = rektionData[item.id];
    let rektionBadge = '';
    if (rektion) {
        if (rektion.type === 'reflexive') {
            rektionBadge = `<span class="ml-1 text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold border border-purple-200">🪞 재귀동사</span>`;
        } else if (rektion.type === 'adjective') {
            rektionBadge = `<span class="ml-1 text-[9px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded font-bold border border-teal-200">🔗 전치사 짝꿍</span>`;
        } else {
            rektionBadge = `<span class="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold border border-amber-200">🔗 전치사 짝꿍</span>`;
        }
    }
    let levelColor = item.level.startsWith('A') ? "bg-yellow-100 text-yellow-800" : "bg-purple-100 text-purple-800";
    
    card.innerHTML = `
        <div class="swipe-hint hint-left font-bold text-red-500 text-xs">알아요 ✅</div>
        <div class="swipe-hint hint-right font-bold text-orange-500 text-xs">몰라요 ❓</div>
        <div class="flex justify-between items-start w-full pointer-events-none mb-1">
             <div class="flex items-center flex-wrap gap-1">
                <span class="font-bold text-xl ${textColor}">${mainText}</span>
                ${cognateBadge}
                ${polysemyBadge}
                ${compoundBadge}
                ${rektionBadge}
             </div>
             <span class="text-[10px] ${levelColor} px-1.5 py-0.5 rounded font-bold">${item.level}</span>
        </div>
        <div class="flex justify-between items-end w-full pointer-events-none">
            <div class="flex flex-col w-full meaning-container transition-opacity duration-300 ${isMeaningHidden ? '' : 'revealed'}">
                <span class="text-gray-800 font-medium text-lg leading-tight">${item.meaning}</span>
                <span class="text-gray-400 text-xs italic mt-0.5">${item.english}</span>
                ${rektion ? buildRektionDisplay(rektion) : ''}
                ${compound ? buildCompoundEtymology(compound) : ''}
            </div>
            <button class="speaker-btn pointer-events-auto text-gray-300 hover:text-indigo-600 p-2 transition z-10" onclick="event.stopPropagation(); speak('${item.partOfSpeech === 'Noun' ? item.gender + ' ' + item.word : item.word}')">
                <span class="text-xl">🔊</span>
            </button>
        </div>
    `;
    attachSwipeEvents(card, item, index);
    return card;
}

/* * ==========================================================================
 * 4. UTILITIES & EVENTS
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

        // 2초 롱프레스: 뜻 가리기 상태에서 뜻 엿보기
        if (isMeaningHidden) {
            longPressTimer = setTimeout(() => {
                const mc = card.querySelector('.meaning-container');
                if (mc && !mc.classList.contains('revealed')) {
                    mc.classList.add('revealed');
                    longPressRevealed = true;
                    // 짧은 진동 피드백
                    if (navigator.vibrate) navigator.vibrate(30);
                }
            }, 2000);
        }
    }, {passive: true});

    card.addEventListener('touchmove', e => {
        if (!isDragging) return;
        currentX = e.touches[0].clientX;
        const diffX = currentX - startX;
        // 움직이기 시작하면 롱프레스 취소
        if (Math.abs(diffX) > 10 && longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
        card.style.transform = `translateX(${diffX}px)`;
        card.querySelector('.hint-left').style.opacity = diffX < 0 ? Math.min(-diffX / 100, 1) : 0;
        card.querySelector('.hint-right').style.opacity = diffX > 0 ? Math.min(diffX / 100, 1) : 0;
    }, {passive: true});

    card.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        // 롱프레스 타이머 정리
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }

        // 롱프레스로 뜻이 보였으면 → 손 떼면 다시 숨기기 (스와이프/탭 무시)
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

function speakNextWord() {
    if (!currentVocabList.length) return;
    const next = currentVocabList[0];
    const text = next.partOfSpeech === 'Noun' ? next.gender + ' ' + next.word : next.word;
    setTimeout(() => speak(text), 300);
}

function removeWord(item) {
    const idx = currentVocabList.indexOf(item);
    if (idx > -1) { deletedHistory.push(item); currentVocabList.splice(idx, 1); renderWords(); saveState(); }
}

function moveWordToBack(item) {
    const idx = currentVocabList.indexOf(item);
    if (idx > -1) { currentVocabList.push(currentVocabList.splice(idx, 1)[0]); renderWords(); saveState(); }
}

function undoDelete() { if (deletedHistory.length) { currentVocabList.unshift(deletedHistory.pop()); renderWords(); saveState(); } }

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

function toggleFilter(pos) { activeFilter = activeFilter === pos ? null : pos; renderWords(); updateCounts(); }

function updateCounts() {
    const counts = { Noun: 0, Verb: 0, Adjective: 0 };
    currentVocabList.forEach(item => counts[item.partOfSpeech]++);
    ['noun', 'verb', 'adjective'].forEach(pos => {
        const el = document.getElementById(`count-${pos}`);
        if (el) el.innerText = counts[pos.charAt(0).toUpperCase() + pos.slice(1)];
    });
    const totalEl = document.getElementById('count-total');
    if (totalEl) totalEl.innerText = currentVocabList.length;
}

function updateLevelTitle() {
    const el = document.getElementById('level-title');
    if (!el) return;
    if (!currentVocabList.length) { el.innerText = "학습 완료!"; return; }
    const lvls = Array.from(new Set(currentVocabList.map(w => w.level))).sort();
    el.innerText = lvls.length > 1 ? `${lvls[0]}-${lvls[lvls.length-1]} 레벨` : `${lvls[0]} 레벨`;
}

function updateUndoButton() {
    const btn = document.getElementById('undoBtn');
    if (btn) btn.classList.toggle('hidden', !deletedHistory.length);
}

function shuffleArray(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }

function shuffleCurrentList() { shuffleArray(currentVocabList); renderWords(); }

function resetList() { if (confirm('초기화하시겠습니까?')) { localStorage.removeItem('germanVocabState_V5'); location.reload(); } }

function toggleDarkMode() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('germanVocab_darkMode', isDark);
    const btn = document.getElementById('darkModeBtn');
    if (btn) btn.innerHTML = isDark ? '☀️ 라이트' : '🌙 다크';
}

function buildCompoundEtymology(compound) {
    let partsHtml = '';
    for (let i = 0; i < compound.parts.length; i++) {
        if (i > 0 && compound.parts[i] !== 's') {
            partsHtml += `<span class="compound-plus">+</span>`;
        }
        if (compound.parts[i] === 's') {
            partsHtml += `<span class="compound-part" style="padding:1px 3px;"><span class="compound-part-word" style="font-size:10px;">s</span><span class="compound-part-meaning">${compound.partMeanings[i]}</span></span>`;
        } else {
            partsHtml += `<span class="compound-part"><span class="compound-part-word">${compound.parts[i]}</span><span class="compound-part-meaning">${compound.partMeanings[i]}</span></span>`;
        }
    }
    return `<div class="compound-etymology mt-1">
        <div class="compound-parts">${partsHtml}</div>
        <div class="compound-note">${compound.note}</div>
    </div>`;
}

function buildRektionDisplay(rektion) {
    if (rektion.patterns.length === 0) {
        return `<div class="rektion-box case-reflexive mt-1">
            <div class="rektion-formula">
                <span class="rektion-sich">sich</span>
                <span class="rektion-verb">재귀동사 (Reflexivverb)</span>
            </div>
            <div class="rektion-meaning-ko">이 동사는 항상 "sich"와 함께 씁니다</div>
        </div>`;
    }

    const primaryCase = rektion.patterns[0].case;
    const boxClass = primaryCase === 'Akk' ? 'case-akk' : 'case-dat';

    let patternsHtml = rektion.patterns.map((pat, i) => {
        const caseClass = pat.case === 'Akk' ? 'rektion-case-akk' : 'rektion-case-dat';
        const caseLabel = pat.case === 'Akk' ? 'Akk. (4격)' : 'Dat. (3격)';
        const verbPart = pat.formula.replace('sich ', '').split(' ')[0];

        let patHtml = i > 0 ? '<div class="rektion-separator"></div>' : '';
        patHtml += `<div class="rektion-formula">`;
        if (rektion.isReflexive) patHtml += `<span class="rektion-sich">sich</span>`;
        patHtml += `<span class="rektion-verb">${verbPart}</span>`;
        patHtml += `<span class="rektion-prep">${pat.prep}</span>`;
        patHtml += `<span class="${caseClass}">+ ${caseLabel}</span>`;
        patHtml += `</div>`;
        patHtml += `<div class="rektion-meaning-ko">${pat.meaningKo}</div>`;
        if (pat.example) {
            patHtml += `<div class="rektion-example">${pat.example}<div class="rektion-example-ko">${pat.exampleKo}</div></div>`;
        }
        return patHtml;
    }).join('');

    return `<div class="rektion-box ${boxClass} mt-1">${patternsHtml}</div>`;
}

function speak(text) { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(text); u.lang = 'de-DE'; u.rate = 0.8; window.speechSynthesis.speak(u); } }

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

initApp();
