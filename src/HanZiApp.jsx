import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@supabase/supabase-js";
import HSK_VOCAB from "../data/hsk_vocab.json";
import GRAMMAR_LESSONS from "../data/grammar_lessons.json";
import ADMIN_CONTENT from "../data/admin_content.json";
import HSK_BOOK_CONTENT from "../data/hsk_standard_course_content.json";
import VOCAB_FIXES from "../data/vocab_fixes.json";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (import.meta.env.DEV) {
  console.log("[HanZi Supabase env]", {
    hasUrl: Boolean(SUPABASE_URL),
    hasAnonKey: Boolean(SUPABASE_ANON_KEY),
    anonKeyPreview: SUPABASE_ANON_KEY ? `${SUPABASE_ANON_KEY.slice(0, 6)}...${SUPABASE_ANON_KEY.slice(-4)}` : "missing",
  });
}
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const ADMIN_EMAIL = "saad19saleme@gmail.com";
const LEVELS = [1, 2, 3, 4, 5];
const levelColor = (level) => ({ 1: "#22C55E", 2: "#3B82F6", 3: "#F59E0B", 4: "#EF4444" }[level] || "#D4A017");
const USE_OPENAI_TTS = import.meta.env.VITE_USE_OPENAI_TTS === "true" || import.meta.env.USE_OPENAI_TTS === "true";
const TTS_VOICE_OPTIONS = [
  { value: "shimmer", label: "Female teacher" },
  { value: "echo", label: "Male teacher" },
  { value: "nova", label: "Young female" },
  { value: "onyx", label: "Professional male" },
  { value: "alloy", label: "HSK listening voice" },
];
const TTS_SPEED_OPTIONS = [
  { value: 0.5, label: "0.5x" },
  { value: 0.75, label: "0.75x" },
  { value: 1, label: "1x" },
];
const PRONUNCIATION_MODES = [
  { value: "slow", label: "Slow pronunciation" },
  { value: "natural", label: "Natural pronunciation" },
  { value: "character", label: "Character-by-character" },
];
const ROLEPLAY_VOICES = {
  "Chinese teacher": "shimmer",
  Teacher: "shimmer",
  Shopkeeper: "echo",
  "Taxi driver": "echo",
  Waiter: "nova",
  "Business client": "onyx",
  "Job interviewer": "onyx",
  "Hotel staff": "nova",
  Friend: "nova",
};
const LEGACY_TTS_VOICE_MAP = {
  femaleTeacher: "shimmer",
  maleTeacher: "echo",
  youngFemale: "nova",
  professionalMale: "onyx",
  hskListening: "alloy",
  calmFemale: "shimmer",
  friendlyMale: "echo",
  casualMale: "echo",
  politeVoice: "nova",
  professionalVoice: "onyx",
  teacher: "shimmer",
  roleplay: "shimmer",
  female: "nova",
  male: "echo",
  "zh-CN": "nova",
  "zh-TW": "nova",
  "Mandarin female": "nova",
  "Mandarin male": "echo",
};
function normalizeTtsVoice(voice) {
  const value = String(voice || "").trim();
  if (TTS_VOICE_OPTIONS.some((item) => item.value === value)) return value;
  return LEGACY_TTS_VOICE_MAP[value] || "nova";
}
const ttsAudioCache = new Map();
let activeStandaloneAudio = null;
let activeBrowserUtteranceKey = null;

function showAudioNotice(message = "Premium AI voice is not active yet. Using browser voice.") {
  window.dispatchEvent(new CustomEvent("hanzi-audio-notice", { detail: message }));
}

function browserVoiceForSelection(selectedVoice = "nova") {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const zhVoices = voices.filter((item) => item.lang?.toLowerCase().startsWith("zh"));
  const pool = zhVoices.length ? zhVoices : voices;
  const hint = selectedVoice === "echo" || selectedVoice === "onyx"
    ? /male|kang|yun|hao|sin-ji|zhiyu|male/i
    : /female|mei|ting|xia|hui|hanhan|zhihui|female/i;
  return pool.find((item) => hint.test(item.name || "")) || pool.find((item) => /zh|chinese|mandarin/i.test(`${item.name} ${item.lang}`)) || pool[0] || null;
}

function playBrowserTts(text, { voice = "nova", speed = 1, volume = 1, key = "browser-tts", onEnd } = {}) {
  if (!window.speechSynthesis || !text) return false;
  if (activeBrowserUtteranceKey === key && window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    activeBrowserUtteranceKey = null;
    return true;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = speed;
  utterance.pitch = voice === "echo" || voice === "onyx" ? 0.88 : 1.05;
  utterance.volume = volume;
  const matchedVoice = browserVoiceForSelection(voice);
  if (matchedVoice) utterance.voice = matchedVoice;
  activeBrowserUtteranceKey = key;
  utterance.onend = () => {
    if (activeBrowserUtteranceKey === key) activeBrowserUtteranceKey = null;
    onEnd?.();
  };
  utterance.onerror = utterance.onend;
  window.speechSynthesis.speak(utterance);
  return true;
}

async function playOpenAiTts(text, { voice = "nova", speed = 1, cachePrefix = "standalone" } = {}) {
  const selectedVoice = normalizeTtsVoice(voice);
  const cacheKey = JSON.stringify({ text, voice: selectedVoice, speed, cachePrefix });
  console.log("[HanZi TTS frontend] selectedVoice =", selectedVoice);
  console.log("[HanZi TTS frontend] request voice", selectedVoice, { provider: "openai", cacheKey });
  let url = ttsAudioCache.get(cacheKey);
  if (!url) {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: selectedVoice, speed }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenAI TTS failed with ${response.status}: ${detail.slice(0, 180)}`);
    }
    const blob = await response.blob();
    url = URL.createObjectURL(blob);
    ttsAudioCache.set(cacheKey, url);
  }
  activeStandaloneAudio?.pause();
  activeStandaloneAudio = new Audio(url);
  await activeStandaloneAudio.play();
}
const HSK5_VERIFIED_VOCAB = [
  ["爱护", "àihù", "to cherish; to protect", "verb", "我们应该爱护公共环境。", "We should cherish and protect the public environment."],
  ["爱惜", "àixī", "to treasure; to use sparingly", "verb", "年轻人要爱惜时间。", "Young people should treasure time."],
  ["安装", "ānzhuāng", "to install", "verb", "技术人员正在安装新的软件。", "The technician is installing new software."],
  ["熬夜", "áoyè", "to stay up late", "verb", "为了准备考试，他连续几天熬夜。", "To prepare for the exam, he stayed up late for several days."],
  ["摆", "bǎi", "to place; to display", "verb", "桌子上摆着几本参考书。", "Several reference books are placed on the table."],
  ["办理", "bànlǐ", "to handle; to process", "verb", "我明天去银行办理手续。", "I will go to the bank tomorrow to handle the formalities."],
  ["傍晚", "bàngwǎn", "toward evening", "noun", "傍晚的校园特别安静。", "The campus is especially quiet toward evening."],
  ["包裹", "bāoguǒ", "package; parcel", "noun", "他收到了家人寄来的包裹。", "He received a package sent by his family."],
  ["宝贵", "bǎoguì", "precious; valuable", "adjective", "这次实习给了我宝贵的经验。", "This internship gave me valuable experience."],
  ["保持", "bǎochí", "to maintain; to keep", "verb", "学习语言需要保持耐心。", "Language learning requires maintaining patience."],
  ["保存", "bǎocún", "to preserve; to save", "verb", "请把文件保存到电脑里。", "Please save the file on the computer."],
  ["报告", "bàogào", "report; to report", "noun/verb", "经理要求我们周五前交报告。", "The manager asked us to submit the report before Friday."],
  ["抱怨", "bàoyuàn", "to complain", "verb", "与其抱怨，不如想办法解决问题。", "Rather than complain, it is better to find a solution."],
  ["背景", "bèijǐng", "background", "noun", "了解文化背景有助于理解文章。", "Understanding the cultural background helps with reading comprehension."],
  ["本科", "běnkē", "undergraduate program", "noun", "她本科毕业以后打算继续读研究生。", "After graduating from undergraduate study, she plans to continue to graduate school."],
  ["毕业", "bìyè", "to graduate", "verb", "毕业以后，他选择去南方工作。", "After graduation, he chose to work in the south."],
  ["避免", "bìmiǎn", "to avoid", "verb", "提前计划可以避免很多麻烦。", "Planning ahead can avoid many troubles."],
  ["编辑", "biānjí", "editor; to edit", "noun/verb", "这篇文章还需要再编辑一次。", "This article still needs to be edited again."],
  ["表达", "biǎodá", "to express", "verb", "他能用中文清楚地表达观点。", "He can clearly express his views in Chinese."],
  ["表面", "biǎomiàn", "surface; appearance", "noun", "不要只看表面，要分析真正的原因。", "Do not only look at the surface; analyze the real cause."],
  ["病毒", "bìngdú", "virus", "noun", "电脑病毒可能会破坏重要资料。", "A computer virus may damage important data."],
  ["播放", "bōfàng", "to broadcast; to play", "verb", "老师播放了一段新闻录音。", "The teacher played a news recording."],
  ["博物馆", "bówùguǎn", "museum", "noun", "这个博物馆介绍了当地历史。", "This museum introduces local history."],
  ["不断", "búduàn", "continuously", "adverb", "城市的交通系统在不断改善。", "The city's transportation system is continuously improving."],
  ["不见得", "bújiànde", "not necessarily", "adverb", "贵的东西不见得一定适合你。", "Expensive things are not necessarily suitable for you."],
  ["不耐烦", "búnàifán", "impatient", "adjective", "服务员虽然很忙，但没有表现得不耐烦。", "Although the waiter was busy, he did not appear impatient."],
  ["部门", "bùmén", "department", "noun", "这个部门负责市场调查。", "This department is responsible for market research."],
  ["财产", "cáichǎn", "property; assets", "noun", "法律保护公民的个人财产。", "The law protects citizens' personal property."],
  ["采访", "cǎifǎng", "to interview", "verb", "记者采访了几位大学生。", "The reporter interviewed several university students."],
  ["采取", "cǎiqǔ", "to adopt; to take", "verb", "学校采取了新的管理办法。", "The school adopted new management methods."],
  ["参考", "cānkǎo", "to consult; reference", "verb/noun", "写论文时要参考可靠资料。", "When writing a paper, consult reliable sources."],
  ["操场", "cāochǎng", "sports field; playground", "noun", "学生们正在操场上练习跑步。", "The students are practicing running on the sports field."],
  ["操心", "cāoxīn", "to worry about", "verb", "父母总是为孩子的未来操心。", "Parents always worry about their children's future."],
  ["测验", "cèyàn", "test; quiz", "noun/verb", "这次测验主要检查听力能力。", "This test mainly checks listening ability."],
  ["产品", "chǎnpǐn", "product", "noun", "新产品上市以后很受欢迎。", "The new product became popular after entering the market."],
  ["产生", "chǎnshēng", "to produce; to arise", "verb", "压力过大容易产生焦虑。", "Too much pressure can easily produce anxiety."],
  ["长途", "chángtú", "long-distance", "adjective/noun", "长途旅行前要准备好证件。", "Before a long-distance trip, prepare your documents."],
  ["超级", "chāojí", "super; extremely", "adverb/adjective", "这家超市的服务超级方便。", "This supermarket's service is extremely convenient."],
  ["朝", "cháo", "toward; facing", "preposition", "他朝门口走去。", "He walked toward the door."],
  ["吵", "chǎo", "noisy; to quarrel", "verb/adjective", "外面太吵，我没听清楚。", "It was too noisy outside, so I did not hear clearly."],
  ["彻底", "chèdǐ", "thorough; thoroughly", "adjective/adverb", "这个问题需要彻底解决。", "This problem needs to be solved thoroughly."],
  ["沉默", "chénmò", "silent; silence", "adjective/noun", "听到这个消息后，他沉默了很久。", "After hearing the news, he was silent for a long time."],
  ["趁", "chèn", "to take advantage of", "preposition", "趁天气好，我们去爬山吧。", "While the weather is good, let's go hiking."],
  ["承担", "chéngdān", "to undertake; to bear", "verb", "成年人应该承担自己的责任。", "Adults should bear their own responsibilities."],
  ["承认", "chéngrèn", "to admit; to acknowledge", "verb", "他承认自己没有准备充分。", "He admitted that he had not prepared fully."],
  ["程度", "chéngdù", "degree; extent", "noun", "这篇文章的难度超过了我的程度。", "The difficulty of this article exceeded my level."],
  ["程序", "chéngxù", "procedure; program", "noun", "请按照程序提交申请。", "Please submit the application according to the procedure."],
  ["吃亏", "chīkuī", "to suffer losses", "verb", "只看价格可能会吃亏。", "Looking only at price may cause you to suffer a loss."],
  ["持续", "chíxù", "to continue; continuous", "verb/adjective", "雨已经持续了三个小时。", "The rain has continued for three hours."],
  ["充满", "chōngmǎn", "to be full of", "verb", "他的演讲充满了信心。", "His speech was full of confidence."],
  ["充分", "chōngfèn", "sufficient; full", "adjective", "考试前要做充分准备。", "You should make sufficient preparations before the exam."],
  ["重复", "chóngfù", "to repeat", "verb", "请不要重复同样的错误。", "Please do not repeat the same mistake."],
  ["抽屉", "chōuti", "drawer", "noun", "护照放在书桌的抽屉里。", "The passport is in the desk drawer."],
  ["出版", "chūbǎn", "to publish", "verb", "这本书去年正式出版。", "This book was officially published last year."],
  ["出色", "chūsè", "outstanding", "adjective", "她在比赛中的表现非常出色。", "Her performance in the competition was outstanding."],
  ["出席", "chūxí", "to attend; to be present", "verb", "校长将出席明天的会议。", "The principal will attend tomorrow's meeting."],
  ["传播", "chuánbō", "to spread; to disseminate", "verb", "互联网加快了信息传播。", "The internet has accelerated information dissemination."],
  ["传染", "chuánrǎn", "to infect; contagious", "verb", "这种疾病容易传染。", "This disease is easy to transmit."],
  ["创造", "chuàngzào", "to create", "verb", "年轻人正在创造新的生活方式。", "Young people are creating new ways of life."],
  ["此外", "cǐwài", "besides; in addition", "conjunction", "此外，我们还需要考虑成本。", "In addition, we also need to consider cost."],
  ["刺激", "cìjī", "to stimulate; exciting", "verb/adjective", "适当的压力能刺激学习动力。", "Appropriate pressure can stimulate motivation to learn."],
  ["从此", "cóngcǐ", "from then on", "adverb", "从此，他每天坚持练习口语。", "From then on, he practiced speaking every day."],
  ["从而", "cóng'ér", "thereby; thus", "conjunction", "多阅读可以扩大词汇量，从而提高写作能力。", "Reading more can expand vocabulary, thereby improving writing ability."],
  ["存在", "cúnzài", "to exist; existence", "verb/noun", "这个计划还存在一些问题。", "This plan still has some problems."],
  ["达到", "dádào", "to reach; to achieve", "verb", "他的中文水平已经达到HSK五级。", "His Chinese level has already reached HSK 5."]
].map(([word, pinyin, meaning, tag, example, exampleMeaning]) => ({ word, pinyin, meaning, hsk: 5, example, exampleMeaning, tags: [tag] }));
const normalizeAdminWord = (item, level, index) => ({
  id: `verified-${level}-${index}-${item.word}`,
  char: item.word,
  pinyin: item.pinyin,
  meaning: item.meaning,
  example: item.example,
  exEn: item.exampleMeaning,
  difficulty: item.hsk || Number(level),
  tags: item.tags || ["verified"],
  verified: true,
});
const VERIFIED_VOCAB = Object.fromEntries(LEVELS.map((level) => [
  String(level),
  [...(ADMIN_CONTENT.vocabulary?.[String(level)] || []), ...(level === 5 ? HSK5_VERIFIED_VOCAB : [])].map((item, index) => normalizeAdminWord(item, level, index)),
]));
const VOCAB_FIX_MAP = VOCAB_FIXES.words || {};
const VERIFIED_CHAR_LEVEL = new Map(Object.entries(VERIFIED_VOCAB).flatMap(([level, words]) => words.map((word) => [word.char, Number(level)])));
const BAD_MEANING_RE = /^(variant of|old variant of|surname|radical)\b|(^|[;/,]\s*)(variant of|old variant of|surname|radical)\b|\babbr\. for\b/i;
const TECHNICAL_MEANING_RE = /\b(variant of|old variant of|radical|abbr\. for|surname)\b/i;
const hasBadMeaning = (meaning = "") => BAD_MEANING_RE.test(meaning);
const cleanLearnerMeaning = (meaning = "") => {
  const parts = meaning
    .split(/\s*\/\s*|\s*;\s*/)
    .map((part) => part.trim())
    .filter((part) => part && !TECHNICAL_MEANING_RE.test(part));
  return parts.join("; ");
};
const learnerExample = (word, meaning) => ({
  example: `请用“${word}”造句。`,
  exEn: `Please make a sentence with "${word}" (${meaning}).`,
});
const cleanExistingWord = (word, level) => {
  const fix = VOCAB_FIX_MAP[word.char];
  const cleanedMeaning = fix?.meaning || cleanLearnerMeaning(word.meaning || "");
  if (!cleanedMeaning || (hasBadMeaning(word.meaning || "") && !fix)) return null;
  const generic = learnerExample(word.char, cleanedMeaning);
  return {
    ...word,
    pinyin: fix?.pinyin || word.pinyin?.replace(/\s+/g, "") || "",
    meaning: cleanedMeaning,
    example: fix?.example || (word.example?.includes("今天学习") ? generic.example : word.example) || generic.example,
    exEn: fix?.exampleMeaning || (word.exEn?.includes("Today's study word") ? generic.exEn : word.exEn) || generic.exEn,
    difficulty: word.difficulty || Number(level),
    tags: [...new Set([...(word.tags || []), ...(fix ? ["cleaned"] : [])])],
  };
};
const wordsForLevel = (level) => {
  const verified = VERIFIED_VOCAB[String(level)] || [];
  const existing = (HSK_VOCAB[String(level)] || [])
    .filter((word) => !VERIFIED_CHAR_LEVEL.has(word.char) || VERIFIED_CHAR_LEVEL.get(word.char) === Number(level))
    .map((word) => cleanExistingWord(word, level))
    .filter(Boolean);
  const seen = new Set();
  return [...verified, ...existing].filter((word) => {
    if (seen.has(word.char)) return false;
    seen.add(word.char);
    return true;
  });
};
const allWords = () => LEVELS.flatMap((level) => wordsForLevel(level));
const totalWords = () => allWords().length;
const WordLookupContext = React.createContext({ onSaveWord: null });
const COMMON_SEGMENT_WORDS = [
  "学习", "朋友", "因为", "所以", "但是", "虽然", "图书馆", "中文", "汉语", "老师", "学生", "学校",
  "今天", "明天", "昨天", "时候", "中国", "北京", "工作", "考试", "练习", "听力", "阅读", "语法",
  "问题", "意思", "可以", "觉得", "准备", "提高", "旅行", "饭店", "医院", "公司", "经理", "服务员",
  "出租车", "手机", "电脑", "天气", "时间", "早上", "晚上", "周末", "每天", "一起", "已经", "正在",
];
const bookLessonsForLevel = (level) => (HSK_BOOK_CONTENT.levels?.[String(level)]?.books || []).flatMap((book) =>
  (book.lessons || []).map((lesson) => ({ ...lesson, bookId: book.id, bookTitle: book.title, sourcePdf: book.sourcePdf, sourceStatus: book.sourceStatus }))
);
const bookTopicsForLevel = (level) => bookLessonsForLevel(level).map((lesson) => lesson.titleCn || lesson.titleEn).filter(Boolean);
const bookLessonByTopic = (level, topic) => bookLessonsForLevel(level).find((lesson) => lesson.titleCn === topic || lesson.titleEn === topic);
const HSK5_TOPICS = ["学习与成长", "大学生活", "职业选择", "社会责任", "环境保护", "科技影响", "文化传播", "采访经历", "消费观念", "时间管理", "压力与健康", "城市发展", "家庭关系", "信息时代", "公共服务", "个人价值", "长期计划", "工作效率", "阅读习惯", "语言表达"];
const sourceTopicsForLevel = (level) => {
  const topics = [...bookTopicsForLevel(level), ...(ADMIN_CONTENT.readingTopics?.[String(level)] || []), ...(Number(level) === 5 ? HSK5_TOPICS : [])];
  return [...new Set(topics)].slice(0, 20);
};
const AUTH_SESSION_KEY = "HanZi_current_user";
const LEGACY_AUTH_SESSION_KEY = "HanZi_session";
const USER_DATA_KEY = "HanZi_user_learning_data";
const TUTOR_CONVERSATION_KEY = "HanZi_ai_tutor_conversation";
const TUTOR_STATE_KEY = "HanZi_ai_tutor_state";
const EXAM_ATTEMPTS_KEY = "HanZi_exam_active_attempts";
const TUTOR_WELCOME = "Hey! I'm HanZi Tutor 👋 Ask me any Chinese word, grammar point, sentence, reading, listening, or HSK question.";
const HSK_TARGETS = { 1: 150, 2: 300, 3: 600, 4: 1200, 5: 2500 };
const XP_REWARDS = {
  word: 5,
  exercise: 10,
  listening: 15,
  reading: 20,
  quiz: 25,
  exam: 100,
  examAbove80: 20,
  examAbove90: 50,
  dailyChallenge: 50,
  grammar: 10,
  flashcard: 3,
};
const RPG_RANKS = [
  { min: 1, max: 5, name: "Beginner", icon: "🌱" },
  { min: 6, max: 10, name: "Explorer", icon: "📘" },
  { min: 11, max: 20, name: "Student", icon: "🎓" },
  { min: 21, max: 35, name: "Scholar", icon: "⚔" },
  { min: 36, max: 50, name: "Advanced Learner", icon: "🏮" },
  { min: 51, max: 70, name: "Expert", icon: "🐉" },
  { min: 71, max: 90, name: "Master", icon: "👑" },
  { min: 91, max: 100, name: "Grandmaster", icon: "🔥" },
];
const RPG_LOCATIONS = ["Village", "Town", "City", "Academy", "Palace", "Dragon Mountain"];
const TOKEN_SHOP_ITEMS = [
  { id: "discount-5", name: "5% Subscription Coupon", cost: 100, detail: "Use tokens toward your next plan." },
  { id: "discount-10", name: "10% Subscription Coupon", cost: 250, detail: "A stronger plan discount." },
  { id: "discount-20", name: "20% Subscription Coupon", cost: 500, detail: "Best for serious learners." },
  { id: "ai-messages", name: "Extra AI Tutor Pack", cost: 120, detail: "More focused AI practice." },
  { id: "trial-extension", name: "Premium Trial Extension", cost: 300, detail: "Extend premium practice time." },
  { id: "dragon-theme", name: "Dragon Mountain Theme", cost: 450, detail: "Exclusive profile theme." },
  { id: "exam-voucher", name: "Exam Voucher Token", cost: 800, detail: "Save toward a future exam plan." },
];
const SUBSCRIPTION_PLANS = [
  {
    id: "standard",
    name: "Standard",
    features: [
      "Full flashcards",
      "Vocabulary lessons",
      "Reading practice",
      "Listening practice",
      "Basic exercises",
      "Daily challenges",
      "Progress tracking",
      "HSK 1-4 learning paths",
      "Audio pronunciation",
      "Limited quizzes",
    ],
    excluded: [
      "AI Tutor",
      "Smart AI corrections",
      "Personalized AI study assistant",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    badge: "Most Popular",
    features: [
      "Everything in Standard",
      "Full AI Tutor access",
      "Unlimited AI conversations",
      "Sentence correction",
      "Grammar explanations",
      "Personalized AI learning",
      "Smart quiz generation",
      "AI reading assistant",
      "AI listening assistant",
      "AI pronunciation help",
      "Advanced HSK preparation",
      "Adaptive learning system",
      "Priority future features",
    ],
  },
];
const PRICING_PERIODS = {
  monthly: { id: "monthly", label: "Monthly", price: "Choose later", days: 30 },
  yearly: { id: "yearly", label: "Yearly", price: "Choose later", days: 365, badge: "Best Value" },
};
const PAYMENT_METHODS = ["Credit/Debit Card", "PayPal", "Alipay", "WeChat Pay"];
const planById = (id) => SUBSCRIPTION_PLANS.find((plan) => plan.id === id);
const SETTINGS_VERSION = "1.0.0";
const COUNTRIES = ["United States", "China", "France", "Morocco", "Egypt", "United Kingdom", "Canada", "Australia", "Other"];
const LANGUAGE_OPTIONS = ["English", "Chinese", "French", "Arabic"];
const HSK_OPTIONS = ["Beginner", "HSK 1", "HSK 2", "HSK 3", "HSK 4", "HSK 5"];
const PROTECTED_PAGES = new Set(["vocab", "reading", "listening", "exercises", "exam", "grammar", "ailab", "tutor", "dashboard", "settings", "admin"]);
const PATH_PAGE_MAP = {
  "/": "home",
  "/home": "home",
  "/features": "home",
  "/plans": "pricing",
  "/pricing": "pricing",
  "/login": "login",
  "/signup": "signup",
  "/vocab": "vocab",
  "/vocabulary": "vocab",
  "/reading": "reading",
  "/listening": "listening",
  "/exercises": "exercises",
  "/exam": "exam",
  "/grammar": "grammar",
  "/ai-lab": "ailab",
  "/ailab": "ailab",
  "/ai-tutor": "tutor",
  "/tutor": "tutor",
  "/dashboard": "dashboard",
  "/settings": "settings",
  "/admin": "admin",
  "/admin-dashboard": "admin",
};
const GRAMMAR_TARGET_COUNTS = { 1: 60, 2: 76, 3: 75, 4: 75, 5: 80 };
const GRAMMAR_POINT_BANK = {
  1: ["SVO word order", "是 for identity", "很 with adjectives", "吗 questions", "的 possession", "measure words with 个", "有 and 没有", "不 negation", "也 and 都", "这/那/哪", "几 and 多少", "time before verb", "dates and weekdays", "在 + place", "去 + place", "想 + verb", "会 for learned ability", "能 for ability", "要 for wanting", "请 for requests", "太...了", "A-not-A questions", "呢 follow-up questions", "和 for and", "family nouns as modifiers", "numbers with measure words", "一点儿", "喜欢 + verb/object", "给 + person", "在...吗"],
  2: ["了 for completed action", "sentence-final 了", "正在 / 在 progressive", "过 for experience", "因为...所以...", "但是 contrast", "虽然...但是...", "比 comparison", "没有...那么", "比...更", "从...到...", "离 distance", "对...感兴趣", "觉得 + clause", "让 + person + verb", "给 as preposition", "跟/和 with", "每...都...", "已经", "就 and 才", "先...再...", "一边...一边...", "可能", "应该", "可以 permission", "要是...就...", "的时候", "以后 / 以前", "得 for degree", "verb + 一下", "verb reduplication", "direction complements 来/去", "result complements 完/好/到", "number + time duration", "多 + adjective", "越来越"],
  3: ["把 sentence", "被 passive", "除了...以外", "不但...而且...", "只要...就...", "只有...才...", "越...越...", "一...就...", "又...又...", "既...又...", "还是 vs 或者", "还是 questions", "关于", "对于", "为了", "由于...所以...", "结果 complement 清楚", "起来", "下去", "出来", "得/地/的 distinction", "可能 vs 会", "差点儿", "几乎", "原来", "本来", "一直", "终于", "后来", "然后", "把...放在", "被...影响", "连...都", "无论...都", "不管...都", "即使...也", "最好", "必须", "不得不"],
  4: ["尽管...还是", "不仅...而且", "与其...不如", "宁可...也不", "否则", "因此", "然而", "同时", "随着", "通过", "根据", "按照", "由于", "为了避免", "值得", "适合", "对...来说", "由...组成", "把...看作", "被认为", "使/让/令", "导致", "造成", "提高/降低", "保持", "采取措施", "进行调查", "作出决定", "承担责任", "解决矛盾", "形成习惯", "养成习惯", "产生影响", "获得经验", "表示态度", "强调观点", "分析原因", "提出建议", "实现目标"],
  5: ["至于", "以免", "何况", "不妨", "难免", "未必", "一旦...就...", "既然...就...", "与其...不如...", "宁可...也不...", "除非...否则...", "无论如何", "由此可见", "总而言之", "换句话说", "相对而言", "从...角度看", "就...而言", "并非...而是...", "不仅如此", "反而", "毕竟", "究竟", "陆续", "纷纷", "逐步", "大大", "格外", "照样", "照常", "所谓", "为主", "为止", "在于", "取决于", "有助于", "有利于", "意味着", "涉及", "面临", "承担", "保持", "避免", "采取措施", "达到目的", "产生影响", "发挥作用", "进行采访", "发表看法", "表达观点", "分析背景", "参考资料", "充分准备", "持续发展", "不断提高", "彻底解决", "存在问题"],
};
const SETTINGS_CATEGORIES = [
  ["profile", "Profile"],
  ["study", "Study"],
  ["audio", "Audio"],
  ["ai", "AI Tutor"],
  ["notifications", "Notifications"],
  ["appearance", "Appearance"],
  ["data", "Progress & Data"],
  ["subscription", "Subscription"],
  ["security", "Security"],
  ["language", "Language"],
  ["support", "Help & Support"],
  ["about", "About"],
];
const UI_TEXT = {
  English: {
    home: "Home",
    vocab: "Vocabulary",
    reading: "Reading",
    listening: "Listening",
    exercises: "Exercises",
    exam: "Exam",
    grammar: "Grammar",
    tutor: "AI Tutor",
    pricing: "Plans",
    dashboard: "Dashboard",
    settings: "Settings",
    saveChanges: "Save Changes",
    upgradePlan: "Upgrade Plan",
    currentPlan: "Current Plan",
    daysRemaining: "Days remaining",
    noActivePlan: "No active plan",
    weeklyStatistics: "Weekly Statistics",
    dailyChallenge: "Daily Challenge",
    hskProgress: "HSK Progress",
    day: "Day",
    xp: "XP",
    plansTitle: "Subscription Plans",
    plansSubtitle: "Choose Standard for the full learning platform, or Premium for HanZi Tutor and AI-powered help. Pricing can be filled in later.",
    startFreeTrial: "Start Free Trial",
    trialActive: "Trial Active",
    trialUsed: "Trial Used",
    subscribe: "Subscribe",
    current: "Current",
    send: "Send",
    thinking: "Thinking...",
    tutorTitle: "AI Tutor",
    tutorSubtitle: "Ask any HSK 1-4 Chinese-learning question. The tutor can explain words, grammar, readings, exercises, quizzes, and sentence corrections.",
    settingsSubtitle: "Manage your HanZi AI profile, study behavior, audio, AI Tutor, subscription, security, and app preferences.",
    changesPreview: "Changes preview instantly and save to this browser profile.",
    profile: "Profile",
    study: "Study",
    audio: "Audio",
    ai: "AI Tutor",
    notifications: "Notifications",
    appearance: "Appearance",
    data: "Progress & Data",
    subscription: "Subscription",
    security: "Security",
    language: "Language",
    support: "Help & Support",
    about: "About",
    profilePicture: "Profile picture",
    username: "Username",
    email: "Email",
    country: "Country",
    nativeLanguage: "Native language",
    currentHskLevel: "Current HSK level",
    joinDate: "Join date",
    currentSubscription: "Current subscription",
    dailyStudyGoal: "Daily study goal",
    dailyStudyTime: "Daily study time",
    preferredHsk: "Preferred HSK level",
    difficulty: "Learning difficulty",
    theme: "Theme",
    accentColor: "Accent color",
    appLanguage: "App language",
    resetProgress: "Reset progress",
    exportStudyData: "Export study data",
    backupProgress: "Backup progress",
    task_words: "Learn words",
    task_listening: "Complete listening",
    task_flashcards: "Review flashcards",
    task_grammar: "Finish grammar",
    keepStreak: "Keep your streak alive",
    greatJob: "Great job! Daily challenge completed.",
  },
  Chinese: {
    home: "首页",
    vocab: "词汇",
    reading: "阅读",
    listening: "听力",
    exercises: "练习",
    exam: "考试",
    grammar: "语法",
    tutor: "AI 导师",
    pricing: "套餐",
    dashboard: "学习面板",
    settings: "设置",
    saveChanges: "保存更改",
    upgradePlan: "升级套餐",
    currentPlan: "当前套餐",
    daysRemaining: "剩余天数",
    noActivePlan: "没有有效套餐",
    weeklyStatistics: "每周统计",
    dailyChallenge: "每日挑战",
    hskProgress: "HSK 进度",
    day: "第",
    xp: "经验值",
    plansTitle: "订阅套餐",
    plansSubtitle: "选择 Standard 使用完整学习功能，选择 Premium 解锁 HanZi AI 导师。",
    startFreeTrial: "开始免费试用",
    trialActive: "试用中",
    trialUsed: "已使用试用",
    subscribe: "订阅",
    current: "当前",
    send: "发送",
    thinking: "思考中...",
    tutorTitle: "AI 导师",
    tutorSubtitle: "提问任何 HSK 1-4 中文学习问题。",
    settingsSubtitle: "管理个人资料、学习、音频、AI 导师、订阅、安全和应用偏好。",
    changesPreview: "更改会立即预览，并保存到此浏览器资料。",
    profile: "个人资料",
    study: "学习",
    audio: "音频",
    ai: "AI 导师",
    notifications: "通知",
    appearance: "外观",
    data: "进度与数据",
    subscription: "订阅",
    security: "安全",
    language: "语言",
    support: "帮助与支持",
    about: "关于",
    profilePicture: "头像",
    username: "用户名",
    email: "邮箱",
    country: "国家",
    nativeLanguage: "母语",
    currentHskLevel: "当前 HSK 等级",
    joinDate: "加入日期",
    currentSubscription: "当前订阅",
    dailyStudyGoal: "每日单词目标",
    dailyStudyTime: "每日学习时间",
    preferredHsk: "首选 HSK 等级",
    difficulty: "学习难度",
    theme: "主题",
    accentColor: "强调色",
    appLanguage: "应用语言",
    resetProgress: "重置进度",
    exportStudyData: "导出学习数据",
    backupProgress: "备份进度",
    task_words: "学习单词",
    task_listening: "完成听力",
    task_flashcards: "复习卡片",
    task_grammar: "完成语法",
    keepStreak: "保持连续学习",
    greatJob: "太棒了！每日挑战已完成。",
  },
  French: {
    home: "Accueil",
    vocab: "Vocabulaire",
    reading: "Lecture",
    listening: "Écoute",
    exercises: "Exercices",
    exam: "Examen",
    grammar: "Grammaire",
    tutor: "Tuteur IA",
    pricing: "Offres",
    dashboard: "Tableau de bord",
    settings: "Paramètres",
    saveChanges: "Enregistrer",
    upgradePlan: "Améliorer l'offre",
    currentPlan: "Offre actuelle",
    daysRemaining: "Jours restants",
    noActivePlan: "Aucune offre active",
    weeklyStatistics: "Statistiques hebdomadaires",
    dailyChallenge: "Défi quotidien",
    hskProgress: "Progression HSK",
    day: "Jour",
    xp: "XP",
    plansTitle: "Offres d'abonnement",
    plansSubtitle: "Choisissez Standard pour l'apprentissage complet, ou Premium pour le tuteur IA HanZi.",
    startFreeTrial: "Essai gratuit",
    trialActive: "Essai actif",
    trialUsed: "Essai utilisé",
    subscribe: "S'abonner",
    current: "Actuel",
    send: "Envoyer",
    thinking: "Réflexion...",
    tutorTitle: "Tuteur IA",
    tutorSubtitle: "Posez une question de chinois HSK 1-4.",
    settingsSubtitle: "Gérez votre profil, étude, audio, IA, abonnement, sécurité et préférences.",
    changesPreview: "Les changements s'affichent instantanément et se sauvegardent dans ce profil.",
    profile: "Profil",
    study: "Étude",
    audio: "Audio",
    ai: "Tuteur IA",
    notifications: "Notifications",
    appearance: "Apparence",
    data: "Progression & données",
    subscription: "Abonnement",
    security: "Sécurité",
    language: "Langue",
    support: "Aide",
    about: "À propos",
    profilePicture: "Photo de profil",
    username: "Nom d'utilisateur",
    email: "E-mail",
    country: "Pays",
    nativeLanguage: "Langue maternelle",
    currentHskLevel: "Niveau HSK actuel",
    joinDate: "Date d'inscription",
    currentSubscription: "Abonnement actuel",
    dailyStudyGoal: "Objectif quotidien",
    dailyStudyTime: "Temps d'étude",
    preferredHsk: "Niveau HSK préféré",
    difficulty: "Difficulté",
    theme: "Thème",
    accentColor: "Couleur d'accent",
    appLanguage: "Langue de l'application",
    resetProgress: "Réinitialiser",
    exportStudyData: "Exporter les données",
    backupProgress: "Sauvegarder",
    task_words: "Apprendre des mots",
    task_listening: "Terminer l'écoute",
    task_flashcards: "Réviser les cartes",
    task_grammar: "Terminer la grammaire",
    keepStreak: "Gardez votre série",
    greatJob: "Bravo ! Défi quotidien terminé.",
  },
  Arabic: {
    home: "الرئيسية",
    vocab: "المفردات",
    reading: "القراءة",
    listening: "الاستماع",
    exercises: "تمارين",
    exam: "الاختبار",
    grammar: "القواعد",
    tutor: "المعلم الذكي",
    pricing: "الخطط",
    dashboard: "لوحة التقدم",
    settings: "الإعدادات",
    saveChanges: "حفظ التغييرات",
    upgradePlan: "ترقية الخطة",
    currentPlan: "الخطة الحالية",
    daysRemaining: "الأيام المتبقية",
    noActivePlan: "لا توجد خطة نشطة",
    weeklyStatistics: "إحصاءات الأسبوع",
    dailyChallenge: "تحدي اليوم",
    hskProgress: "تقدم HSK",
    day: "اليوم",
    xp: "نقاط",
    plansTitle: "خطط الاشتراك",
    plansSubtitle: "اختر Standard للتعلم الكامل أو Premium لمعلم HanZi الذكي.",
    startFreeTrial: "ابدأ التجربة المجانية",
    trialActive: "التجربة نشطة",
    trialUsed: "تم استخدام التجربة",
    subscribe: "اشترك",
    current: "الحالي",
    send: "إرسال",
    thinking: "يفكر...",
    tutorTitle: "المعلم الذكي",
    tutorSubtitle: "اسأل عن أي موضوع صيني من HSK 1-4.",
    settingsSubtitle: "إدارة الملف الشخصي والدراسة والصوت والذكاء الاصطناعي والاشتراك والأمان.",
    changesPreview: "تظهر التغييرات فوراً ويتم حفظها في هذا الملف.",
    profile: "الملف الشخصي",
    study: "الدراسة",
    audio: "الصوت",
    ai: "المعلم الذكي",
    notifications: "الإشعارات",
    appearance: "المظهر",
    data: "التقدم والبيانات",
    subscription: "الاشتراك",
    security: "الأمان",
    language: "اللغة",
    support: "المساعدة",
    about: "حول",
    profilePicture: "الصورة الشخصية",
    username: "اسم المستخدم",
    email: "البريد الإلكتروني",
    country: "البلد",
    nativeLanguage: "اللغة الأم",
    currentHskLevel: "مستوى HSK الحالي",
    joinDate: "تاريخ الانضمام",
    currentSubscription: "الاشتراك الحالي",
    dailyStudyGoal: "هدف الدراسة اليومي",
    dailyStudyTime: "وقت الدراسة اليومي",
    preferredHsk: "مستوى HSK المفضل",
    difficulty: "الصعوبة",
    theme: "السمة",
    accentColor: "لون التمييز",
    appLanguage: "لغة التطبيق",
    resetProgress: "إعادة ضبط التقدم",
    exportStudyData: "تصدير البيانات",
    backupProgress: "نسخ احتياطي",
    task_words: "تعلم كلمات",
    task_listening: "أكمل الاستماع",
    task_flashcards: "راجع البطاقات",
    task_grammar: "أكمل القواعد",
    keepStreak: "حافظ على السلسلة",
    greatJob: "عمل رائع! تم إكمال تحدي اليوم.",
  },
};
const uiText = (language, key) => UI_TEXT[language]?.[key] || UI_TEXT.English[key] || key;

function readStorage(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    // Local storage may be unavailable in private or restricted browser modes.
  }
}

const normalizeEmail = (value = "") => value.trim().toLowerCase();
const isValidEmail = (value = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const pageFromCurrentPath = () => {
  const pathname = window.location.pathname.replace(/\/+$/, "") || "/";
  return PATH_PAGE_MAP[pathname.toLowerCase()] || null;
};
const createSupabaseSession = (user) => ({
  id: user.id,
  name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || "HanZi learner",
  fullName: user.user_metadata?.full_name || user.user_metadata?.name || "",
  email: user.email || "",
  dateOfBirth: user.user_metadata?.date_of_birth || "",
  emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
  createdAt: user.created_at,
});
async function saveSupabaseProfile(authUser, overrides = {}) {
  if (!supabase || !authUser?.id) return;
  const profile = {
    id: authUser.id,
    full_name: overrides.fullName ?? authUser.user_metadata?.full_name ?? authUser.user_metadata?.name ?? "",
    email: overrides.email ?? authUser.email ?? "",
    date_of_birth: overrides.dateOfBirth ?? authUser.user_metadata?.date_of_birth ?? null,
    updated_at: new Date().toISOString(),
  };
  try {
    await supabase.from("profiles").upsert(profile, { onConflict: "id" });
  } catch {
    // A profiles table is optional; Supabase Auth metadata remains the source of truth.
  }
}
async function saveSupabaseLearningState(userId, state) {
  if (!supabase || !userId) return;
  try {
    await supabase.from("learning_progress").upsert({
      user_id: userId,
      state,
      xp: state?.xp || 0,
      tokens: state?.gamification?.tokens || 0,
      player_level: playerLevelFromXp(state?.xp || 0),
      rank: normalizeGamification(state).rank,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  } catch {
    // If the optional learning_progress table is not created yet, local persistence remains active.
  }
}
async function supabaseProfileEmailExists(email) {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.from("profiles").select("id").eq("email", normalizeEmail(email)).maybeSingle();
    return !error && Boolean(data?.id);
  } catch {
    return false;
  }
}
function isSupabaseAuthCallback() {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return Boolean(
    query.get("code") ||
    query.get("type") ||
    hash.get("access_token") ||
    hash.get("refresh_token") ||
    hash.get("type")
  );
}
function clearAuthCallbackUrl() {
  window.history.replaceState({}, document.title, window.location.pathname);
}
function userAge(dateOfBirth) {
  const birth = parseDateKey(dateOfBirth);
  if (!birth) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const birthdayThisYear = new Date(today.getFullYear(), birth.getMonth(), birth.getDate());
  if (today < birthdayThisYear) age -= 1;
  return age;
}

const createTutorState = () => ({
  currentTopic: null,
  lastWord: null,
  lastGrammar: null,
  lastSentence: null,
  lastExercise: null,
  lastReading: null,
  lastListening: null,
  quizMode: null,
  lastExamples: [],
  usedExamples: {},
});

function loadTutorConversation() {
  const saved = readStorage(TUTOR_CONVERSATION_KEY, null);
  if (Array.isArray(saved) && saved.length) {
    return saved
      .filter((message) => message?.role && typeof message.content === "string")
      .map((message) => ({
        role: message.role,
        content: message.content,
        audioItems: Array.isArray(message.audioItems) ? message.audioItems : [],
      }));
  }
  return [{ role: "assistant", content: TUTOR_WELCOME, audioItems: [] }];
}

const compactTutorHistory = (messages) => messages
  .filter((message) => message?.role && typeof message.content === "string")
  .map(({ role, content }) => ({ role, content }));

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(key) {
  if (!key) return null;
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function addDaysToKey(key, amount) {
  const date = parseDateKey(key) || new Date();
  date.setDate(date.getDate() + amount);
  return todayKey(date);
}

function daysBetweenKeys(startKey, endKey) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end) return 0;
  return Math.floor((end - start) / 86400000);
}

function createWeeklyStats(startDate = null) {
  return Array.from({ length: 7 }, (_, index) => ({
    day: index + 1,
    date: startDate ? addDaysToKey(startDate, index) : null,
    xp: 0,
    minutes: 0,
  }));
}

function normalizeWeeklyState(state, dateKey = todayKey()) {
  const existing = Array.isArray(state.weeklyStats) ? state.weeklyStats : [];
  const hasDatedStats = existing.some((item) => item?.date);
  if (!state.weekStartDate) {
    const totalXp = hasDatedStats ? 0 : existing.reduce((sum, item) => sum + Number(item?.xp || 0), 0);
    const totalMinutes = hasDatedStats ? 0 : existing.reduce((sum, item) => sum + Number(item?.minutes || 0), 0);
    state.weekStartDate = state.firstStudyDate || state.lastStudyDate || dateKey;
    state.firstStudyDate = state.firstStudyDate || state.weekStartDate;
    state.weeklyStats = createWeeklyStats(state.weekStartDate);
    if (totalXp || totalMinutes) {
      state.weeklyStats[0].xp = totalXp;
      state.weeklyStats[0].minutes = totalMinutes;
    }
  } else {
    let offset = daysBetweenKeys(state.weekStartDate, dateKey);
    if (offset < 0 || offset >= 7) {
      state.weekStartDate = dateKey;
      state.weeklyStats = createWeeklyStats(dateKey);
      offset = 0;
    } else {
      const previous = existing;
      state.weeklyStats = createWeeklyStats(state.weekStartDate).map((slot, index) => {
        const match = previous.find((item) => item?.date === slot.date) || previous[index] || {};
        return { ...slot, xp: Number(match.xp || 0), minutes: Number(match.minutes || 0) };
      });
    }
    state.firstStudyDate = state.firstStudyDate || state.weekStartDate;
  }
  return state;
}

function dateAfterDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function subscriptionIsActive(subscription) {
  if (!subscription || subscription.status === "free") return false;
  return !subscription.expiresAt || new Date(subscription.expiresAt) > new Date();
}

function subscriptionIsPremium(progress) {
  const subscription = progress?.subscription;
  if (!subscriptionIsActive(subscription)) return false;
  return subscription.status === "trial" || subscription.planType === "premium" || subscription.planId === "premium";
}

function subscriptionHasLearningAccess(progress) {
  const subscription = progress?.subscription;
  if (!subscriptionIsActive(subscription)) return false;
  return subscription.status === "trial" || ["standard", "premium"].includes(subscription.planType || subscription.planId);
}

function subscriptionName(progress) {
  const subscription = progress?.subscription;
  if (!subscriptionIsActive(subscription)) return "Free";
  if (subscription.status === "trial") return "Free Trial";
  const planType = subscription.planType || subscription.planId;
  const plan = planById(planType);
  const period = PRICING_PERIODS[subscription.period];
  if (plan && period) return `${plan.name} ${period.label}`;
  if (plan) return plan.name;
  return "Free";
}

function subscriptionDaysRemaining(progress) {
  const expiresAt = progress?.subscription?.expiresAt;
  if (!expiresAt || !subscriptionIsActive(progress?.subscription)) return 0;
  return Math.max(0, Math.ceil((new Date(expiresAt) - new Date()) / 86400000));
}

function createDefaultSettings() {
  return {
    profile: {
      avatar: "",
      bio: "",
      country: "United States",
      nativeLanguage: "English",
    },
    study: {
      dailyWords: "10 words/day",
      dailyTime: "30 min",
      preferredHsk: "HSK 1",
      difficulty: "Balanced",
      autoPlayPronunciation: false,
      showPinyin: true,
      showTranslations: true,
      spacedRepetition: true,
      dailyReminders: true,
    },
    audio: {
      voiceSpeed: 1,
      voiceType: "nova",
      pronunciationMode: "natural",
      replayCount: 2,
      autoReadSentences: false,
      listeningExercises: true,
      language: "zh-CN",
      volume: 1,
    },
    aiTutor: {
      answerStyle: "Short answers",
      explanationLevel: "Beginner explanations",
      conversationMode: true,
      strictChineseOnly: false,
      englishSupport: true,
    },
    notifications: {
      dailyReminder: true,
      streakReminder: true,
      quizReminder: false,
      reviewReminder: true,
      emailNotifications: false,
    },
    appearance: {
      theme: "Dark mode",
      accentColor: "Gold",
      fontSize: 16,
      chatBubbleStyle: "Rounded",
      compactMode: false,
    },
    security: {
      twoFactor: false,
      loginAlerts: true,
      rememberDevices: true,
    },
    language: {
      appLanguage: "English",
    },
  };
}

function normalizeSettings(settings = {}) {
  const defaults = createDefaultSettings();
  const normalized = Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, { ...value, ...(settings[key] || {}) }])
  );
  normalized.audio.voiceType = normalizeTtsVoice(normalized.audio.voiceType);
  return normalized;
}

function quizAccuracy(progress) {
  const history = progress?.quizHistory || [];
  if (!history.length) return "0%";
  const score = history.reduce((sum, item) => sum + Number(item.score || 0), 0);
  return `${Math.round((score / (history.length * 6)) * 100)}%`;
}

function playerLevelFromXp(xp = 0) {
  return Math.min(100, Math.max(1, Math.floor(Number(xp || 0) / 300) + 1));
}

function xpForLevel(level) {
  return Math.max(0, (Number(level || 1) - 1) * 300);
}

function playerRank(level) {
  return RPG_RANKS.find((rank) => level >= rank.min && level <= rank.max) || RPG_RANKS[0];
}

function buildLearningPath(preferences = {}, progress = {}) {
  const current = preferredHskNumber({ preferences, settings: progress.settings });
  const target = Math.max(current, preferredHskNumber({ preferences: { targetLevel: preferences.targetLevel || preferences.level } }));
  const words = Number(preferences.wordsPerDay || 10);
  const weak = detectWeakAreas(progress).slice(0, 3).map((item) => item.name);
  const focus = preferences.skills || weak[0] || "Vocabulary";
  return Array.from({ length: 18 }, (_, index) => {
    const location = RPG_LOCATIONS[Math.min(RPG_LOCATIONS.length - 1, Math.floor(index / 3))];
    const level = Math.min(4, Math.max(current, Math.min(target || 4, current + Math.floor(index / 5))));
    const type = ["word", "reading", "grammar", "listening", "exercise", "boss"][index % 6];
    const labels = {
      word: `Learn ${Math.min(30, words + index)} HSK ${level} words`,
      reading: `Clear Reading ${index + 1} in ${location}`,
      grammar: `Master Grammar Lesson ${index + 1}`,
      listening: `Complete Listening Trial ${index + 1}`,
      exercise: `Win Practice Duel ${index + 1}`,
      boss: `${["Vocabulary", "Reading", "Grammar", "Listening"][index % 4]} Boss Challenge`,
    };
    return {
      id: `mission-${index + 1}`,
      number: index + 1,
      title: labels[type],
      type,
      hskLevel: level,
      location,
      focus: weak[index % Math.max(1, weak.length)] || focus,
      rewardXp: type === "boss" ? 180 : 60 + (index % 4) * 20,
      rewardTokens: type === "boss" ? 25 : 5 + (index % 4) * 3,
      status: index === 0 ? "active" : "locked",
    };
  });
}

function buildWeeklyQuests(preferences = {}) {
  return [
    { id: "weekly-answers", label: "Answer 50 checked questions", target: 50, value: 0, rewardXp: 300, rewardTokens: 40, completed: false },
    { id: "weekly-correct", label: "Get 35 answers correct", target: 35, value: 0, rewardXp: 350, rewardTokens: 45, completed: false },
    { id: "weekly-exam", label: "Complete one exam submission", target: 1, value: 0, rewardXp: 260, rewardTokens: 35, completed: false },
  ];
}

function createGamificationState(preferences = {}, progress = {}) {
  return {
    tokens: 0,
    rank: "Beginner",
    learningPath: buildLearningPath(preferences, progress),
    weeklyQuests: buildWeeklyQuests(preferences),
    bossChallenges: [],
    achievements: {},
    rewardedAnswers: {},
    shopPurchases: [],
    skillTree: { vocabulary: 0, grammar: 0, reading: 0, listening: 0, speaking: 0, writing: 0 },
    leaderboardOptIn: false,
    lastReward: null,
  };
}

function normalizeGamification(progress = {}) {
  const base = createGamificationState(progress.preferences || {}, progress);
  const game = { ...base, ...(progress.gamification || {}) };
  const level = playerLevelFromXp(progress.xp);
  const rank = playerRank(level);
  game.rank = `${rank.icon} ${rank.name}`;
  game.tokens = Number(game.tokens || 0);
  game.learningPath = Array.isArray(game.learningPath) && game.learningPath.length ? game.learningPath : buildLearningPath(progress.preferences || {}, progress);
  game.weeklyQuests = Array.isArray(game.weeklyQuests) && game.weeklyQuests.length ? game.weeklyQuests : buildWeeklyQuests(progress.preferences || {});
  game.achievements = game.achievements || {};
  game.rewardedAnswers = game.rewardedAnswers || {};
  game.shopPurchases = game.shopPurchases || [];
  game.skillTree = { ...base.skillTree, ...(game.skillTree || {}) };
  return game;
}

function createInitialLearningState() {
  return {
    onboardingComplete: false,
    preferences: null,
    subscription: {
      planType: "free",
      planId: "free",
      period: null,
      status: "free",
      startedAt: null,
      expiresAt: null,
      trialActive: false,
      trialUsed: false,
      paymentMethod: null,
      paymentHistory: [],
    },
    settings: createDefaultSettings(),
    xp: 0,
    streak: 0,
    wordsLearned: 0,
    listeningCompleted: 0,
    exercisesCompleted: 0,
    flashcardsReviewed: 0,
    readingsCompleted: 0,
    grammarCompleted: 0,
    speakingCompleted: 0,
    quizzesCompleted: 0,
    studyMinutesToday: 0,
    lastStudyDate: null,
    learnedWords: {},
    quizHistory: [],
    listeningHistory: [],
    readingHistory: [],
    examHistory: [],
    mistakeReview: [],
    weakSkills: {},
    aiLabHistory: [],
    firstStudyDate: null,
    weekStartDate: null,
    weeklyStats: createWeeklyStats(),
    hskProgress: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    gamification: createGamificationState(),
    dailyChallenge: {
      title: "Complete your first study activity",
      tasks: [
        { id: "words", label: "Learn 5 words", target: 5, value: 0 },
        { id: "reading", label: "Read one article", target: 1, value: 0 },
        { id: "listening", label: "Complete 1 listening exercise", target: 1, value: 0 },
        { id: "grammar", label: "Finish 1 grammar lesson", target: 1, value: 0 },
      ],
      completed: false,
    },
  };
}

function allUserData() {
  return readStorage(USER_DATA_KEY, {});
}

function getLearningState(userId) {
  if (!userId) return createInitialLearningState();
  const data = allUserData();
  const state = { ...createInitialLearningState(), ...(data[userId] || {}) };
  state.settings = normalizeSettings(state.settings);
  state.gamification = normalizeGamification(state);
  return normalizeWeeklyState(state);
}

function saveLearningState(userId, state) {
  if (!userId) return;
  const data = allUserData();
  data[userId] = state;
  writeStorage(USER_DATA_KEY, data);
  saveSupabaseLearningState(userId, state);
}

function normalizeGrammarLesson(lesson, index) {
  const examples = (lesson.examples || []).map((example) => ({
    cn: example.cn,
    py: example.py || "",
    en: example.en || "",
    breakdown: example.breakdown || [],
  }));
  return {
    ...lesson,
    id: `core-grammar-${lesson.id || index + 1}`,
    lessonNumber: index + 1,
    formula: lesson.formula || lesson.structure || lesson.title,
    examples,
    mistakes: lesson.mistakes || [],
    practice: lesson.practice || [
      { question: `Make one sentence using ${lesson.title}.`, answer: examples[0]?.cn || "" },
      { question: "Choose the correct word order.", answer: examples[0]?.cn || "" },
    ],
    xpReward: XP_REWARDS.grammar,
    source: "Local HSK grammar material",
  };
}

function generatedGrammarLesson(level, index, globalIndex) {
  const bank = GRAMMAR_POINT_BANK[level];
  const title = bank[index % bank.length];
  const lessonNumber = index + 1;
  const word = gradedWordsForLevel(level)[index % Math.max(1, gradedWordsForLevel(level).length)] || { char: "中文", pinyin: "Zhongwen", meaning: "Chinese" };
  const formulas = {
    1: "Subject + grammar point + verb/object",
    2: "Context + grammar point + result",
    3: "Clause A + grammar point + Clause B",
    4: "Topic + formal structure + explanation/result",
  };
  const examples = [
    { cn: `我今天学习${word.char}。`, py: `Wo jintian xuexi ${word.pinyin}.`, en: `I study ${word.meaning} today.`, breakdown: [{ w: "我", r: "wo", t: "subject" }, { w: "学习", r: "xuexi", t: "verb" }, { w: word.char, r: word.pinyin, t: "key word" }] },
    { cn: level <= 2 ? `因为下雨，所以我在家复习。` : `虽然这个问题比较复杂，但是我们可以慢慢分析。`, py: level <= 2 ? "Yinwei xia yu, suoyi wo zai jia fuxi." : "Suiran zhege wenti bijiao fuza, danshi women keyi manman fenxi.", en: level <= 2 ? "Because it is raining, I review at home." : "Although this problem is complex, we can analyze it slowly.", breakdown: [] },
    { cn: level <= 2 ? `请你再说一遍。` : `只要坚持练习，听力就会逐渐提高。`, py: level <= 2 ? "Qing ni zai shuo yi bian." : "Zhiyao jianchi lianxi, tingli jiu hui zhujian tigao.", en: level <= 2 ? "Please say it again." : "As long as you keep practicing, listening will gradually improve.", breakdown: [] },
  ];
  return {
    id: `expanded-grammar-${level}-${lessonNumber}`,
    level,
    lessonNumber,
    title,
    rule: `Use "${title}" in HSK ${level} to connect ideas clearly and build level-appropriate sentences. Focus on word order, the relationship between clauses, and whether the structure expresses time, reason, contrast, result, condition, or attitude.`,
    formula: formulas[level],
    examples,
    mistakes: [`Do not translate "${title}" word-for-word from English.`, "Keep Chinese word order stable and check whether the grammar point needs a second clause or result."],
    tip: `Practice "${title}" with familiar HSK ${level} vocabulary before using longer sentences.`,
    practice: [
      { question: `Complete a sentence using ${title}.`, answer: examples[0].cn },
      { question: "Translate the model sentence into English.", answer: examples[0].en },
      { question: "Correct the word order if needed.", answer: examples[1].cn },
    ],
    xpReward: XP_REWARDS.grammar,
    source: "Expanded HSK 1-4 grammar curriculum",
    order: globalIndex,
  };
}

function buildExpandedGrammarLessons() {
  const core = GRAMMAR_LESSONS.map(normalizeGrammarLesson);
  const byLevel = Object.fromEntries(LEVELS.map((level) => [level, core.filter((lesson) => Number(lesson.level) === level)]));
  let order = 1;
  return LEVELS.flatMap((level) => {
    const target = GRAMMAR_TARGET_COUNTS[level];
    const normalizedCore = byLevel[level].map((lesson, index) => ({ ...lesson, lessonNumber: index + 1, order: order++ }));
    const needed = Math.max(0, target - normalizedCore.length);
    const generated = Array.from({ length: needed }, (_, index) => generatedGrammarLesson(level, index, order++));
    return [...normalizedCore, ...generated].map((lesson, index) => ({ ...lesson, lessonNumber: index + 1 }));
  });
}

const GRAMMAR_CURRICULUM = buildExpandedGrammarLessons();

function buildDailyChallenge(preferences) {
  return {
    title: "Today's answered-question challenge",
    tasks: [
      { id: "exerciseAnswers", label: "Answer 5 exercise questions", target: 5, value: 0, rewardXp: 50, rewardTokens: 10 },
      { id: "quizAnswers", label: "Answer 3 quiz questions", target: 3, value: 0, rewardXp: 40, rewardTokens: 8 },
      { id: "examAnswers", label: "Submit exam answers", target: 1, value: 0, rewardXp: 60, rewardTokens: 10 },
      { id: "aiPractice", label: "Answer 1 AI Tutor practice question", target: 1, value: 0, rewardXp: 30, rewardTokens: 6 },
    ],
    completed: false,
  };
}

function nextMastery(current) {
  const levels = ["New", "Learning", "Familiar", "Mastered"];
  const index = Math.max(0, levels.indexOf(current || "New"));
  return levels[Math.min(index + 1, levels.length - 1)];
}

function nextReviewDate(mastery) {
  const interval = { New: 1, Learning: 3, Familiar: 7, Mastered: 30 }[mastery] || 1;
  const date = new Date();
  date.setDate(date.getDate() + interval);
  return date.toISOString();
}

function verifiedWordsForLevel(level) {
  return VERIFIED_VOCAB[String(level)]?.length ? VERIFIED_VOCAB[String(level)] : wordsForLevel(level).slice(0, 12);
}

function gradedWordsForLevel(level) {
  return LEVELS.filter((item) => item <= Number(level)).flatMap((item) => verifiedWordsForLevel(item));
}

const READING_VOCAB_STOP_WORDS = new Set([
  "我", "你", "他", "她", "它", "们", "的", "了", "是", "不", "很", "在", "有", "和", "也", "都", "就", "这", "那", "个", "一", "二", "三", "四", "五",
  "我们", "你们", "他们", "这个", "那个", "一个", "可以", "没有", "不是", "什么", "时候"
]);

const READING_PHRASE_BANK = [
  ["星期一", "xīngqī yī", "Monday", "time word", 1],
  ["星期二", "xīngqī èr", "Tuesday", "time word", 1],
  ["星期三", "xīngqī sān", "Wednesday", "time word", 1],
  ["星期四", "xīngqī sì", "Thursday", "time word", 1],
  ["星期五", "xīngqī wǔ", "Friday", "time word", 1],
  ["周末", "zhōumò", "weekend", "noun", 2],
  ["早上", "zǎoshang", "morning", "time word", 1],
  ["晚上", "wǎnshang", "evening", "time word", 1],
  ["起床", "qǐchuáng", "to get up", "verb", 1],
  ["吃米饭", "chī mǐfàn", "to eat rice", "verb phrase", 1],
  ["喝水", "hē shuǐ", "to drink water", "verb phrase", 1],
  ["学校", "xuéxiào", "school", "noun", 1],
  ["老师", "lǎoshī", "teacher", "noun", 1],
  ["学习", "xuéxí", "to study; to learn", "verb", 1],
  ["回家", "huí jiā", "to go home", "verb phrase", 1],
  ["公共汽车", "gōnggòng qìchē", "bus", "noun", 2],
  ["饭馆", "fànguǎn", "restaurant", "noun", 2],
  ["生词", "shēngcí", "new words", "noun", 2],
  ["参加", "cānjiā", "to participate", "verb", 3],
  ["活动", "huódòng", "activity", "noun", 3],
  ["经验", "jīngyàn", "experience", "noun", 3],
  ["交流", "jiāoliú", "to communicate; exchange", "verb", 3],
  ["讨论", "tǎolùn", "to discuss; discussion", "verb/noun", 4],
  ["社会", "shèhuì", "society", "noun", 4],
  ["压力", "yālì", "pressure", "noun", 4],
  ["分析", "fēnxī", "to analyze", "verb", 4],
  ["论坛", "lùntán", "forum", "noun", 5],
  ["背景", "bèijǐng", "background", "noun", 5],
  ["判断能力", "pànduàn nénglì", "judgment ability", "noun phrase", 5],
  ["表面现象", "biǎomiàn xiànxiàng", "surface phenomenon", "noun phrase", 5],
  ["由此可见", "yóucǐ kějiàn", "from this it can be seen", "grammar phrase", 5]
];

function readingVocabDataFromWord(word) {
  return {
    pinyin: word.pinyin || "",
    meaning: word.meaning || "",
    grammar: word.tags?.find((tag) => !["cleaned", "verified"].includes(tag)) || word.partOfSpeech || "word",
    hskLevel: word.difficulty || word.hskLevel || "",
  };
}

function buildReadingVocabulary(text = "", level = 1, topic = "", existingWords = {}) {
  const seen = new Set();
  const addCandidate = (word, data, score) => {
    const clean = String(word || "").trim();
    if (!clean || seen.has(clean) || READING_VOCAB_STOP_WORDS.has(clean) || !text.includes(clean)) return null;
    seen.add(clean);
    return {
      word: clean,
      data: {
        pinyin: data.pinyin || "",
        meaning: data.meaning || clean,
        grammar: data.grammar || data.partOfSpeech || "word",
        hskLevel: data.hskLevel || data.difficulty || level,
      },
      score,
    };
  };

  const candidates = [];
  Object.entries(existingWords || {}).forEach(([word, data]) => {
    const item = addCandidate(word, data || {}, 120 + String(word).length * 6);
    if (item) candidates.push(item);
  });
  READING_PHRASE_BANK.forEach(([word, pinyin, meaning, grammar, phraseLevel]) => {
    const item = addCandidate(word, { pinyin, meaning, grammar, hskLevel: phraseLevel }, 180 + phraseLevel * 4 + word.length * 8);
    if (item) candidates.push(item);
  });
  allWords().forEach((word) => {
    const char = word.char || "";
    if (char.length < 2 && Number(word.difficulty) <= 2) return;
    const item = addCandidate(char, readingVocabDataFromWord(word), 80 + char.length * 10 + Number(word.difficulty || level) * 5);
    if (item) candidates.push(item);
  });
  if (topic && text.includes(topic)) {
    const item = addCandidate(topic, { pinyin: "", meaning: topic, grammar: "topic" }, 200 + String(topic).length * 8);
    if (item) candidates.push(item);
  }

  const sorted = candidates.sort((a, b) => b.score - a.score || b.word.length - a.word.length);
  if (sorted.length < 5) {
    const fallbackTerms = [...text.matchAll(/[\u4e00-\u9fff]{2,4}/g)].map((match) => match[0]);
    fallbackTerms.forEach((term, index) => {
      if (sorted.length >= 5) return;
      const item = addCandidate(term, { pinyin: "", meaning: "Key term from this reading", grammar: "reading word", hskLevel: level }, 30 - index);
      if (item) sorted.push(item);
    });
  }
  return Object.fromEntries(sorted.slice(0, 12).map((item) => [item.word, item.data]));
}

const READING_GRAMMAR = {
  1: ["是 sentence", "有", "time word + subject + verb", "很 + adjective", "basic question with 吗"],
  2: ["因为...所以...", "了 for completed actions", "要 / 想", "比", "从...到..."],
  3: ["虽然...但是...", "把 sentence", "越来越", "除了...以外", "一边...一边..."],
  4: ["不但...而且...", "由于...因此...", "被 sentence", "无论...都...", "只有...才..."],
  5: ["一旦...就...", "既然...就...", "与其...不如...", "由此可见", "就...而言", "从而", "并非...而是..."],
};

function passageForTopic(level, topic, index) {
  const words = verifiedWordsForLevel(level);
  const lesson = bookLessonByTopic(level, topic);
  const pick = (offset) => words[(index + offset) % words.length];
  const a = pick(0);
  const b = pick(1);
  const c = pick(2);
  const d = pick(3);
  const shapes = {
    1: {
      text: `今天我学习中文。我的话题是${topic}。我和朋友一起练习“${a.char}”“${b.char}”和“${c.char}”。老师说，慢慢学很好。晚上我回家复习。`,
      translation: `Today I study Chinese. My topic is ${topic}. My friend and I practice "${a.char}", "${b.char}", and "${c.char}". The teacher says studying slowly is good. In the evening I go home and review.`,
      pinyin: `Jīntiān wǒ xuéxí Zhōngwén. Wǒ de huàtí shì ${topic}. Wǒ hé péngyou yìqǐ liànxí.`
    },
    2: {
      text: `这个星期我准备学习${topic}。因为我想提高中文，所以我每天听三句话，也写五个新词。虽然时间不多，但是我觉得这个方法很有用。`,
      translation: `This week I am preparing to study ${topic}. Because I want to improve Chinese, I listen to three sentences every day and write five new words. Although I do not have much time, I think this method is useful.`,
      pinyin: `Zhège xīngqī wǒ zhǔnbèi xuéxí ${topic}. Yīnwèi wǒ xiǎng tígāo Zhōngwén.`
    },
    3: {
      text: `关于${topic}，我有一次很有意思的经历。开始的时候，我觉得不太容易。后来我发现，只要每天坚持练习，听力和阅读都会逐渐提高。这个经验让我更有信心。`,
      translation: `About ${topic}, I had an interesting experience. At first, I felt it was not easy. Later I discovered that as long as I practiced every day, listening and reading would gradually improve. This experience gave me more confidence.`,
      pinyin: `Guānyú ${topic}, wǒ yǒu yí cì hěn yǒu yìsi de jīnglì.`
    },
    4: {
      text: `在讨论${topic}的时候，我们需要考虑不同人的态度和责任。一个好的解决办法不一定最简单，但是应该清楚、实际，而且能够减少问题带来的影响。坚持分析和复习，可以帮助学习者准备HSK考试。`,
      translation: `When discussing ${topic}, we need to consider different people's attitudes and responsibilities. A good solution is not necessarily the simplest, but it should be clear, practical, and able to reduce the influence of the problem. Persistent analysis and review can help learners prepare for the HSK exam.`,
      pinyin: `Zài tǎolùn ${topic} de shíhou, wǒmen xūyào kǎolǜ bùtóng rén de tàidu hé zérèn.`
    },
    5: {
      text: `围绕${topic}，我们不妨从学习、工作和社会三个角度进行分析。一旦只注意表面现象，就容易忽视问题产生的背景。比如，有些人抱怨机会太少，实际上却没有持续提高自己的能力；也有人充分利用资源，从而创造出新的可能。由此可见，真正宝贵的经验并非来自简单重复，而是来自不断反思、承担责任和采取行动。`,
      translation: `Around ${topic}, we may analyze it from the angles of study, work, and society. Once we only pay attention to surface phenomena, we easily ignore the background that produced the problem. Some people complain that opportunities are too few, but in fact they have not continuously improved their abilities; others make full use of resources and thereby create new possibilities. Truly valuable experience comes from reflection, responsibility, and action.`,
      pinyin: `Wéirào ${topic}, wǒmen bùfáng cóng xuéxí, gōngzuò hé shèhuì sān ge jiǎodù jìnxíng fēnxī.`
    }
  };
  const shape = shapes[level] || shapes[1];
  return {
    id: `verified-reading-${level}-${index + 1}`,
    level,
    title: lesson?.titleCn || topic,
    titleEn: lesson ? `${lesson.bookTitle} · Lesson ${lesson.lesson}: ${lesson.titleEn}` : `HSK ${level} Reading ${index + 1}`,
    text: shape.text,
    pinyin: shape.pinyin,
    translation: shape.translation,
    words: buildReadingVocabulary(shape.text, level, topic, {
      [a.char]: { pinyin: a.pinyin, meaning: a.meaning, grammar: a.tags?.[0] || "word" },
      [b.char]: { pinyin: b.pinyin, meaning: b.meaning, grammar: b.tags?.[0] || "word" },
      [c.char]: { pinyin: c.pinyin, meaning: c.meaning, grammar: c.tags?.[0] || "word" },
      [d.char]: { pinyin: d.pinyin, meaning: d.meaning, grammar: d.tags?.[0] || "word" },
      [topic]: { pinyin: "", meaning: topic, grammar: "topic" }
    }),
    questions: [
      { question: "这篇短文的话题是什么？", answer: topic },
      { question: "学习者每天做什么？", answer: level <= 2 ? "听句子、写新词" : "坚持练习、复习" },
      { question: "这篇短文主要说明什么？", answer: "坚持学习可以提高中文。" }
    ],
    verified: true,
    source: lesson ? {
      type: "HSK Standard Course lesson topic",
      book: lesson.bookTitle,
      lesson: lesson.lesson,
      pdf: lesson.sourcePdf,
      note: "Original practice text based on the book lesson topic; not a verbatim copyrighted excerpt."
    } : {
      type: "Admin practice topic",
      note: "Original practice text based on verified local vocabulary."
    }
  };
}

function professionalPassageForTopic(level, topic, index) {
  const words = gradedWordsForLevel(level);
  const pick = (offset) => words[(index + offset) % words.length] || { char: topic, pinyin: "", meaning: topic, tags: ["topic"] };
  const day = ["星期一", "星期二", "星期三", "星期四", "星期五", "周末"][index % 6];
  const place = ["学校", "家", "商店", "饭馆", "图书馆", "车站"][index % 6];
  const person = ["老师", "朋友", "妈妈", "同学", "经理", "医生"][index % 6];
  const levelText = {
    1: `${day}早上，我七点起床。我吃米饭，喝水，然后去${place}。${person}很好，也很忙。今天的天气很好，我和朋友一起学习中文。晚上我回家看书，也给家人打电话。`,
    2: `这个周末，我想和朋友一起学习${topic}。我们先坐公共汽车去${place}，再在附近的饭馆吃饭。因为下雨，所以我们带了伞。朋友觉得时间不够，可是我已经准备好了书和本子。吃完饭以后，我们计划复习生词，然后做几个练习。`,
    3: `上个月，我参加了一次关于${topic}的活动。开始的时候，我觉得内容有点难，因为老师说得比较快，很多词我只在书上见过。后来，我一边听一边记笔记，还主动问同学问题。活动结束以后，我发现自己不但听懂了主要意思，而且能用中文介绍自己的看法。这次经历让我明白，学习语言不能只看课本，还要多参加真实的交流。`,
    4: `最近，学校组织了一次关于${topic}的讨论。参加的人有学生、老师，也有几位在公司工作的毕业生。大家认为，现代社会变化很快，一个人如果只依靠过去的经验，很难解决新的问题。比如在学习和工作中，技术给我们带来了方便，也带来了压力。有人每天用手机查资料，却没有时间认真思考；也有人通过网络找到合作伙伴，逐渐提高了效率。老师提醒我们，面对复杂情况，最重要的不是马上下结论，而是先调查事实，分析原因，再选择合适的方法。讨论结束后，我写了一篇短文，记录不同人的态度和建议。我觉得，这样的练习不但能提高中文阅读能力，而且能帮助我们更清楚地表达观点。`,
    5: `最近，学校围绕${topic}组织了一场论坛。主持人先介绍了相关背景，随后邀请学生、教师和企业代表分别表达看法。有人认为，信息传播速度不断加快，年轻人一旦缺少判断能力，就可能被表面现象影响；也有人指出，科技并非只带来问题，而是提供了更多学习和创造的机会。就个人发展而言，关键在于能否充分利用资源，并且持续反思自己的选择。论坛结束后，我采访了几位同学。大家普遍承认，准备HSK五级不仅需要扩大词汇量，还要学会分析文章结构、理解作者态度，并用更自然的中文表达复杂观点。由此可见，语言能力的提高取决于长期积累，也取决于是否愿意承担学习责任。`,
  };
  const translations = {
    1: `On ${day}, I get up at seven. I eat rice, drink water, and then go to the ${place}. The ${person} is kind and busy. The weather is good, so my friend and I study Chinese together. In the evening I go home, read, and call my family.`,
    2: `This weekend I want to study ${topic} with a friend. We first take the bus to the ${place}, then eat at a nearby restaurant. Because it is raining, we bring umbrellas. My friend thinks there is not enough time, but I have prepared books and notebooks. After eating, we plan to review new words and do several exercises.`,
    3: `Last month I joined an activity about ${topic}. At first the content felt difficult because the teacher spoke quickly and many words were familiar only from books. Later I listened while taking notes and asked classmates questions. After the activity, I could understand the main ideas and introduce my opinion in Chinese. This experience taught me that language learning needs real communication, not only textbooks.`,
    4: `Recently, the school organized a discussion about ${topic}. Participants included students, teachers, and several graduates working in companies. Everyone believed that modern society changes quickly, and relying only on past experience makes it hard to solve new problems. Technology brings convenience and pressure. Some people use phones to find information but do not think deeply; others find partners online and gradually improve efficiency. The teacher reminded us to investigate facts, analyze causes, and choose suitable methods before reaching conclusions. I wrote a short essay recording different attitudes and suggestions. This practice improves Chinese reading and helps us express opinions clearly.`,
    5: `Recently, the school organized a forum around ${topic}. The host introduced the background, then invited students, teachers, and business representatives to express their views. Some people argued that information spreads faster and young people may be influenced by surface phenomena if they lack judgment; others pointed out that technology does not only create problems but also provides more chances to learn and create. In terms of personal development, the key is whether one can fully use resources and keep reflecting on choices. After the forum, I interviewed several classmates. They generally admitted that preparing for HSK 5 requires not only more vocabulary, but also the ability to analyze text structure, understand the author's attitude, and express complex ideas naturally in Chinese.`,
  };
  const text = levelText[level] || levelText[1];
  const keyWords = [pick(0), pick(1), pick(2), pick(3), pick(4), pick(5)];
  const seedWords = Object.fromEntries(keyWords.map((word) => [word.char, { pinyin: word.pinyin, meaning: word.meaning, grammar: word.tags?.[0] || "word" }]));
  seedWords[topic] = { pinyin: "", meaning: topic, grammar: "topic" };
  const wordsMap = buildReadingVocabulary(text, level, topic, seedWords);
  const questions = [
    { question: "这篇文章主要谈什么？", answer: topic },
    { question: "文章里提到了什么地点？", answer: place },
    { question: "文章里提到了谁？", answer: person },
    { question: level <= 2 ? "学习者准备做什么？" : "作者从经历中学到了什么？", answer: level <= 2 ? "学习中文、复习生词、做练习。" : "真实交流和认真分析可以提高中文能力。" },
    { question: "这篇文章的态度是积极还是消极？", answer: "积极。" },
    ...(level >= 3 ? [{ question: "作者为什么觉得这次经历有帮助？", answer: "因为它帮助作者理解真实交流和表达观点的重要性。" }] : []),
    ...(level >= 4 ? [{ question: "老师建议先做什么再下结论？", answer: "先调查事实，分析原因，再选择方法。" }] : []),
  ];
  return {
    id: `graded-reading-${level}-${index + 1}`,
    level,
    title: topic,
    titleEn: `HSK ${level} Reading ${index + 1}`,
    text,
    pinyin: `Pinyin guide: HSK ${level} ${topic}. Use the audio controls and key vocabulary pinyin below for sentence-by-sentence pronunciation support.`,
    translation: translations[level],
    words: wordsMap,
    questions,
    grammarPoints: READING_GRAMMAR[level],
    sentenceAnalysis: [
      { sentence: `${text.split("。")[0]}。`, note: "Find the time phrase, subject, verb, and object before moving on." },
      { sentence: text.split("。")[1] ? `${text.split("。")[1]}。` : text, note: `This sentence supports the topic "${topic}" with context, reason, or result.` },
    ],
    xpReward: XP_REWARDS.reading,
    verified: true,
    source: { type: "Graded HSK original passage", note: "Original graded practice text written for HanZi AI." },
  };
}

function buildVerifiedReadings() {
  return LEVELS.flatMap((level) => {
    const adminReadings = (ADMIN_CONTENT.readings?.[String(level)] || []).map((item, index) => {
      const sourceWords = Array.isArray(item.words)
        ? Object.fromEntries(item.words.map((word) => [word.word, { pinyin: word.pinyin, meaning: word.meaning, grammar: word.grammar || "word" }]))
        : (item.words || {});
      const words = buildReadingVocabulary(item.text || "", level, item.title || "", sourceWords);
      return {
        id: item.id || `admin-reading-${level}-${index + 1}`,
        level,
        title: item.title,
        titleEn: item.titleEn || `HSK ${level} Admin Reading ${index + 1}`,
        text: item.text,
        pinyin: item.pinyin || "",
        translation: item.translation || "",
        words,
        questions: item.questions || [],
        verified: true,
        adminContent: true,
      };
    });
    const generated = sourceTopicsForLevel(level).map((topic, index) => professionalPassageForTopic(level, topic, index));
    return [...generated, ...adminReadings];
  });
}

const VERIFIED_READINGS = buildVerifiedReadings();

function listeningSentence(level, index) {
  const lessons = bookLessonsForLevel(level);
  const lesson = lessons[index % Math.max(lessons.length, 1)];
  if (lesson) {
    const topic = lesson.titleCn || lesson.titleEn;
    const otherTopics = lessons
      .filter((item) => item.lesson !== lesson.lesson)
      .slice(0, 3)
      .map((item) => item.titleCn || item.titleEn);
    const sentence = level <= 2
      ? `今天我们学习第${lesson.lesson}课：${topic}。`
      : `今天的HSK四级主题是第${lesson.lesson}课：${topic}。`;
    return {
      id: `book-listening-${level}-${index + 1}`,
      level,
      sentence,
      question: "这句话提到了哪一课的话题？",
      choices: [topic, ...otherTopics].slice(0, 4),
      answer: topic,
      explanation: `关键词是“第${lesson.lesson}课”和“${topic}”。`,
      verified: true,
      source: {
        type: "HSK Standard Course lesson topic",
        book: lesson.bookTitle,
        lesson: lesson.lesson,
        note: "Original listening practice based on the book lesson topic; not a verbatim copyrighted excerpt."
      }
    };
  }
  const subjects = ["我", "他", "她", "老师", "朋友", "学生", "我们", "他们", "妈妈", "爸爸"];
  const times = ["今天", "明天", "早上", "晚上", "周末", "下课以后", "考试以前", "吃饭以后", "昨天", "这个星期"];
  const levelActions = {
    1: ["去学校学习中文", "喝水看书", "和朋友聊天", "在家吃米饭", "给老师打电话"],
    2: ["坐公共汽车去公园", "因为下雨所以在家学习", "准备明天的考试", "去饭馆吃中国食物", "觉得这个电影很好看"],
    3: ["为了提高听力每天听短文", "虽然很忙但是坚持复习", "发现这个方法很有用", "选择在图书馆学习", "和同事讨论工作经验"],
    4: ["讨论环境问题的影响", "逐渐养成良好的学习习惯", "承认错误并解决问题", "准备一篇考试作文", "分析不同人的态度和责任"]
    ,
    5: ["围绕社会现象表达自己的观点", "采访同学并分析相关背景", "充分利用资源从而提高效率", "承担责任并持续改进计划", "避免只看表面现象而忽视原因"]
  };
  const subject = subjects[index % subjects.length];
  const time = times[index % times.length];
  const action = levelActions[level][index % levelActions[level].length];
  const sentence = `${time}${subject}${action}。`;
  return {
    id: `verified-listening-${level}-${index + 1}`,
    level,
    sentence,
    question: "这句话主要说了什么？",
    choices: [
      `${subject}${action}`,
      `${subject}不学习中文`,
      `${subject}去买衣服`,
      `${subject}没有时间`
    ],
    answer: `${subject}${action}`,
    explanation: `关键词是“${subject}”和“${action}”。`,
    verified: true
  };
}

function buildListeningItems(level) {
  const adminItems = (ADMIN_CONTENT.listening?.[String(level)] || []).map((item, index) => ({
    id: item.id || `admin-listening-${level}-${index + 1}`,
    level,
    sentence: item.sentence,
    question: item.question,
    choices: item.choices || [],
    answer: item.answer,
    explanation: item.explanation || "Listen for the key words in the sentence.",
    verified: true,
    adminContent: true,
  }));
  return [...adminItems, ...Array.from({ length: 50 }, (_, index) => listeningSentence(level, index))];
}

function professionalListeningItem(level, index) {
  const topics = {
    1: ["问候", "家庭", "数字", "买水果", "吃饭", "天气", "学校", "时间", "朋友", "喝水"],
    2: ["餐厅点菜", "问路", "周末计划", "坐公共汽车", "看病", "买衣服", "上课以后", "旅游准备", "咖啡店", "找工作"],
    3: ["旅行经历", "学习方法", "工作讨论", "网络购物", "健康习惯", "城市生活", "文化活动", "面试准备", "邻居关系", "提高听力"],
    4: ["商务会议", "新闻报道", "职业发展", "大学生活", "社会调查", "文化差异", "团队合作", "消费习惯", "信息安全", "个人发展"],
  }[level] || HSK5_TOPICS;
  const topic = topics[index % topics.length];
  const text = {
    1: `你好，我叫小明。我家有三个人。今天早上我八点去学校，中午吃米饭，下午和朋友学习中文。`,
    2: `今天晚上，我和朋友去饭馆吃饭。服务员说今天有面条、米饭和茶。因为朋友不吃肉，所以我们点了两个菜和一杯水。吃完以后，我们坐公共汽车回家。`,
    3: `上周我坐火车去上海旅行。刚到的时候，我找不到酒店，所以给朋友打电话。朋友告诉我先坐地铁，再走五分钟。虽然路有点远，但是我看到了很多有意思的地方，也练习了问路。`,
    4: `今天的会议讨论了公司明年的发展计划。经理认为，市场变化很快，如果团队不能及时调查客户的需要，就很难做出正确决定。几位同事提出，应该利用网络收集信息，同时提高服务质量。最后，大家决定下周交一份详细报告。`,
  }[level] || `今天的节目采访了一位长期研究${topic}的老师。她认为，现代社会的信息传播速度很快，人们不但要学会获得资料，更要学会判断资料是否可靠。以学习中文为例，很多学生一开始只重视背词，后来才发现，真正影响表达能力的，是能否把词语、语法和文化背景联系起来。她建议学习者保持好奇心，充分利用阅读和听力材料，并在每次练习后总结自己的弱点。这样坚持下去，水平就会不断提高。`;
  const choices = [
    topic,
    level <= 2 ? "天气预报" : "体育比赛",
    level <= 2 ? "生日礼物" : "电影介绍",
    level <= 2 ? "买手机" : "音乐活动",
  ];
  return {
    id: `graded-listening-${level}-${index + 1}`,
    level,
    type: "monologue",
    title: topic,
    sentence: text,
    pinyin: `Pinyin guide: HSK ${level} ${topic}. Use slow playback and replay to shadow the recording.`,
    translation: {
      1: "Hello, my name is Xiaoming. There are three people in my family. This morning I go to school at eight, eat rice at noon, and study Chinese with a friend in the afternoon.",
      2: "Tonight my friend and I go to a restaurant. The waiter says there are noodles, rice, and tea today. Because my friend does not eat meat, we order two dishes and a cup of water. After eating, we take the bus home.",
      3: "Last week I took the train to Shanghai. When I arrived, I could not find the hotel, so I called a friend. My friend told me to take the subway first and then walk five minutes. Although the road was a little far, I saw many interesting places and practiced asking directions.",
      4: "Today's meeting discussed the company's development plan for next year. The manager believes the market changes quickly, and if the team cannot investigate customer needs in time, it will be hard to make correct decisions. Several colleagues suggested collecting information online while improving service quality. Finally, everyone decided to submit a detailed report next week.",
    }[level] || `Today's program interviewed a teacher who has long studied ${topic}. She believes that in modern society information spreads quickly, and people must not only learn to obtain materials but also judge whether they are reliable. Taking Chinese learning as an example, many students first focus only on memorizing words, but later discover that real expressive ability depends on connecting vocabulary, grammar, and cultural background. She suggests that learners stay curious, use reading and listening materials fully, and summarize weak points after every practice.`,
    vocabulary: gradedWordsForLevel(level).slice(index, index + 6).map((word) => ({ word: word.char, pinyin: word.pinyin, meaning: word.meaning })),
    question: "这段听力主要谈什么？",
    choices,
    answer: topic,
    questions: [
      { question: "这段听力主要谈什么？", answer: topic },
      { question: level <= 2 ? "说话的人最后怎么回家？" : "说话的人遇到了什么问题？", answer: level === 2 ? "坐公共汽车回家。" : level === 3 ? "找不到酒店。" : "需要做出正确决定。" },
      { question: "这段话的语气怎么样？", answer: "清楚、自然。" },
    ],
    explanation: `Listen for the topic words around "${topic}" and the final result sentence.`,
  };
}

function buildProfessionalListeningItems(level) {
  return Array.from({ length: 24 }, (_, index) => professionalListeningItem(level, index));
}

function buildDialogueItems(level) {
  const data = {
    1: [
      { title: "Student ↔ Teacher", speakers: [["学生", "老师，您好！今天我们学什么？"], ["老师", "今天我们学中文、数字和时间。"], ["学生", "太好了。我想多练习。"]] },
      { title: "Customer ↔ Shopkeeper", speakers: [["顾客", "这个苹果多少钱？"], ["店员", "三个十块钱。"], ["顾客", "我要三个，谢谢。"]] },
    ],
    2: [
      { title: "Friend ↔ Friend", speakers: [["朋友甲", "周末你有时间吗？"], ["朋友乙", "有。我们去饭馆吃饭吧。"], ["朋友甲", "好，因为下雨，我们坐公共汽车去。"]] },
      { title: "Doctor ↔ Patient", speakers: [["医生", "你哪儿不舒服？"], ["病人", "我头疼，也有点累。"], ["医生", "多喝水，今天早点休息。"]] },
    ],
    3: [
      { title: "Traveler ↔ Hotel Staff", speakers: [["旅客", "你好，我预订了一个房间，但是找不到订单。"], ["前台", "请给我看一下护照和电话号码。"], ["旅客", "好的。这个房间离地铁站远吗？"], ["前台", "不远，走路大约五分钟。"]] },
      { title: "Employee ↔ Manager", speakers: [["员工", "经理，我想讨论一下这个项目的时间。"], ["经理", "可以。你觉得最大的困难是什么？"], ["员工", "资料还不完整，所以需要再调查两天。"], ["经理", "好，周五以前给我结果。"]] },
    ],
    4: [
      { title: "Business Conversation", speakers: [["经理", "这次合作的重点是服务质量和客户反馈。"], ["员工", "我同意。我们已经收集了一部分数据，但是还需要分析原因。"], ["经理", "请把报告分成三个部分：问题、影响和解决办法。"], ["员工", "没问题。我明天下午发给您。"]] },
      { title: "News-style Interview", speakers: [["记者", "您为什么关注城市交通问题？"], ["专家", "因为交通影响工作效率，也影响居民的生活质量。"], ["记者", "您认为应该怎么改善？"], ["专家", "政府、企业和市民都需要承担责任，逐步改变出行习惯。"]] },
    ],
  }[level];
  return Array.from({ length: 12 }, (_, index) => {
    const base = data[index % data.length];
    const text = base.speakers.map(([speaker, line]) => `${speaker}：${line}`).join("\n");
    return {
      id: `dialogue-${level}-${index + 1}`,
      level,
      type: "dialogue",
      title: `${base.title} ${index + 1}`,
      speakers: base.speakers,
      sentence: text,
      pinyin: `Pinyin guide: HSK ${level} dialogue. Play each speaker line slowly and repeat aloud.`,
      translation: "Dialogue practice for listening comprehension. Use the speaker labels, vocabulary, and answer key to check meaning.",
      vocabulary: gradedWordsForLevel(level).slice(index, index + 6).map((word) => ({ word: word.char, pinyin: word.pinyin, meaning: word.meaning })),
      questions: [
        { question: "这段对话是谁和谁在说话？", answer: base.title },
        { question: "他们主要讨论什么？", answer: base.speakers[0][1] },
        { question: "最后有什么结果或建议？", answer: base.speakers.at(-1)[1] },
      ],
      question: "这段对话是谁和谁在说话？",
      choices: [base.title, "两个陌生人在银行", "一家人在家", "学生在考试"],
      answer: base.title,
      explanation: "Use the speaker labels and opening sentence to identify the situation.",
    };
  });
}

function buildExerciseItems(level) {
  const words = gradedWordsForLevel(level);
  const grammar = GRAMMAR_CURRICULUM.filter((item) => item.level === level);
  const lesson = bookLessonsForLevel(level)[0];
  const make = (index) => {
    const a = words[index % words.length] || words[0];
    const b = words[(index + 1) % words.length] || a;
    const c = words[(index + 2) % words.length] || a;
    const d = words[(index + 3) % words.length] || a;
    const point = grammar[index % Math.max(1, grammar.length)] || { title: "SVO word order" };
    const type = ["multiple choice", "fill in the blank", "sentence ordering", "translate English to Chinese", "translate Chinese to English", "correct the wrong sentence", "match word with meaning", "match pinyin with character", "listening dictation", "reading comprehension", "grammar practice"][index % 11];
    const base = {
      id: `hsk-${level}-exercise-${index + 1}`,
      level,
      type,
      relatedVocabulary: [a.char, b.char],
      relatedGrammar: point.title,
      xpReward: XP_REWARDS.exercise,
      verified: true,
    };
    const sentence = level <= 1 ? "我今天学习中文。" : level === 2 ? "因为下雨，所以我在家学习。" : level === 3 ? "虽然工作很忙，但是我每天复习。" : "我们需要认真分析并解决这个复杂的问题。";
    const templates = {
      "multiple choice": { prompt: `"${a.char}" means:`, choices: [a.meaning, b.meaning, c.meaning, d.meaning], answer: a.meaning, explanation: `${a.char} (${a.pinyin}) means ${a.meaning}.` },
      "fill in the blank": { prompt: "我今天____中文。", answer: "学习", explanation: "学习 means to study or learn." },
      "sentence ordering": { prompt: "Put in order: 中文 / 我 / 学习 / 今天", answer: "我今天学习中文", explanation: "Chinese order: subject + time + verb + object." },
      "translate English to Chinese": { prompt: "Translate: I study Chinese every day.", answer: "我每天学习中文", explanation: "Time word 每天 usually comes before the verb." },
      "translate Chinese to English": { prompt: sentence, answer: level <= 1 ? "I study Chinese today." : "Translate the full sentence meaning.", explanation: "Focus on the grammar relation, not only individual words." },
      "correct the wrong sentence": { prompt: "Correct: 我去学校昨天。", answer: "我昨天去学校", explanation: "Time normally comes before the verb phrase." },
      "match word with meaning": { prompt: `Match: ${b.char}`, answer: b.meaning, explanation: `${b.char} means ${b.meaning}.` },
      "match pinyin with character": { prompt: `Which character is ${c.pinyin}?`, choices: [a.char, b.char, c.char, d.char], answer: c.char, explanation: `${c.char} is pronounced ${c.pinyin}.` },
      "listening dictation": { prompt: sentence, answer: sentence.replace(/[。，！？]/g, ""), explanation: "Listen and type the Chinese sentence." },
      "reading comprehension": { prompt: professionalPassageForTopic(level, ADMIN_CONTENT.readingTopics[String(level)]?.[index % 20] || "学习中文", index).text, answer: "学习中文", explanation: "Read for the topic, people, place, and result." },
      "grammar practice": { prompt: `Make a sentence using: ${point.title}`, answer: point.examples?.[0]?.cn || sentence, explanation: `Use the pattern: ${point.formula || point.title}.` },
    };
    return { ...base, ...templates[type] };
  };
  const expanded = Array.from({ length: 50 }, (_, index) => make(index));
  const adminExercises = (ADMIN_CONTENT.exercises?.[String(level)] || []).map((item, index) => ({
    id: item.id || `admin-exercise-${level}-${index + 1}`,
    level,
    type: item.type || "practice",
    prompt: item.prompt,
    choices: item.choices,
    answer: item.answer,
    explanation: item.explanation || "Review the key vocabulary and grammar pattern.",
    relatedVocabulary: [],
    relatedGrammar: "Admin practice",
    xpReward: XP_REWARDS.exercise,
    verified: true,
    adminContent: true,
  }));
  return [...expanded, ...adminExercises].slice(0, 50);
}

/*
  const words = verifiedWordsForLevel(level);
  const levelSentence = {
    1: "我今天学习中文。",
    2: "因为下雨，所以我在家学习。",
    3: "虽然工作很忙，但是我每天复习。",
    4: "我们需要认真分析并解决这个复杂的问题。"
  }[level];
  const generated = [
    ...(lesson ? [{
      id: `book-topic-${level}-${lesson.lesson}`,
      type: "book lesson topic",
      prompt: `Which HSK Standard Course lesson topic matches this Chinese title?\n${lesson.titleCn}`,
      choices: [lesson.titleEn, "A weather report", "A restaurant menu", "A train ticket"].filter(Boolean),
      answer: lesson.titleEn,
      explanation: `${lesson.bookTitle} Lesson ${lesson.lesson}: ${lesson.titleCn} means "${lesson.titleEn}".`
    }] : []),
    { id: `ex-${level}-mc`, type: "multiple choice", prompt: `“${a.char}” means:`, choices: [a.meaning, b.meaning, c.meaning, d.meaning], answer: a.meaning, explanation: `${a.char} (${a.pinyin}) means ${a.meaning}.` },
    { id: `ex-${level}-blank`, type: "fill in the blank", prompt: `我想____中文。`, answer: level === 1 ? "学习" : "提高", explanation: "Choose a verb that naturally fits the sentence." },
    { id: `ex-${level}-en-cn`, type: "translate English to Chinese", prompt: "Translate: I study Chinese every day.", answer: "我每天学习中文", explanation: "Time word 每天 usually comes before the verb." },
    { id: `ex-${level}-cn-en`, type: "translate Chinese to English", prompt: levelSentence, answer: levelSentence.includes("虽然") ? "Although work is busy, I review every day." : "I study Chinese today.", explanation: "Translate the whole sentence, not word by word." },
    { id: `ex-${level}-order`, type: "sentence ordering", prompt: "Put in order: 中文 / 我 / 学习 / 今天", answer: "我今天学习中文", explanation: "Chinese order: subject + time + verb + object." },
    { id: `ex-${level}-correct`, type: "correct the wrong sentence", prompt: "Correct: 我去学校昨天。", answer: "我昨天去学校", explanation: "Time usually comes before the verb in Chinese." },
    { id: `ex-${level}-match-meaning`, type: "match word with meaning", prompt: `Match: ${b.char}`, answer: b.meaning, explanation: `${b.char} means ${b.meaning}.` },
    { id: `ex-${level}-match-pinyin`, type: "match pinyin with character", prompt: `Which character is ${c.pinyin}?`, answer: c.char, explanation: `${c.char} is pronounced ${c.pinyin}.` },
    { id: `ex-${level}-dictation`, type: "listening dictation", prompt: levelSentence, answer: levelSentence.replace(/[。！？]/g, ""), explanation: "Listen and type the Chinese sentence." },
    { id: `ex-${level}-reading`, type: "reading comprehension", prompt: passageForTopic(level, ADMIN_CONTENT.readingTopics[String(level)][0], 0).text, answer: ADMIN_CONTENT.readingTopics[String(level)][0], explanation: "Find the topic mentioned in the passage." }
  ];
  const adminExercises = (ADMIN_CONTENT.exercises?.[String(level)] || []).map((item, index) => ({
    id: item.id || `admin-exercise-${level}-${index + 1}`,
    type: item.type || "practice",
    prompt: item.prompt,
    choices: item.choices,
    answer: item.answer,
    explanation: item.explanation || "Review the key vocabulary and grammar pattern.",
    verified: true,
    adminContent: true,
  }));
  return [...adminExercises, ...generated];
}
*/

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;700&family=Noto+Sans+SC:wght@300;400;500;700&family=DM+Sans:wght@400;500;600;700&display=swap');
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body { margin: 0; }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes floatUp { from { transform: translateY(20vh) rotate(0deg); opacity: 0; } 15%, 85% { opacity: .11; } to { transform: translateY(-110vh) rotate(24deg); opacity: 0; } }
      @keyframes typing { 50% { opacity: .28; } }
      .hz-app { --bg:#060610; --nav-bg:rgba(6,6,16,.9); --card-bg:rgba(255,255,255,.045); --panel-bg:rgba(255,255,255,.075); --secondary-card-bg:rgba(255,255,255,.06); --input-bg:rgba(255,255,255,.08); --text:#EDE8DC; --heading:#F5C842; --secondary-text:rgba(237,232,220,.76); --muted:rgba(237,232,220,.62); --border:rgba(212,175,55,.18); --accent:#F5C842; --accent-2:#E8A020; --accent-dark:#B8860B; --danger:#E53935; --danger-2:#C62828; --success:#4CAF7D; --button-text:#060610; --option-bg:#141421; --shadow:none; --card-radius:12px; --footer-bg:rgba(6,6,16,.95); min-height: 100vh; background: var(--bg); color: var(--text); font-family: 'Noto Sans SC', 'DM Sans', sans-serif; overflow-x: hidden; }
      .hz-theme-light { color-scheme: light; --bg:#F8F6F1; --nav-bg:#FCFAF5; --card-bg:#FFFFFF; --panel-bg:#FFFFFF; --secondary-card-bg:#FFFDF8; --input-bg:#FFFFFF; --text:#1F2937; --heading:#1F2937; --secondary-text:#4B5563; --muted:#6B7280; --border:#D1D5DB; --accent:#D4A017; --accent-2:#F4C542; --accent-dark:#B8860B; --danger:#DC2626; --danger-2:#B91C1C; --success:#16A34A; --button-text:#111827; --option-bg:#FFFFFF; --shadow:0 4px 12px rgba(0,0,0,0.06); --card-radius:16px; --footer-bg:#F5F2EA; }
      .hz-theme-amoled { --bg:#000000; --nav-bg:rgba(0,0,0,.94); --card-bg:rgba(255,255,255,.035); --panel-bg:rgba(255,255,255,.07); --input-bg:rgba(255,255,255,.075); --text:#F5F2EA; --muted:rgba(245,242,234,.62); --border:rgba(245,200,66,.2); --option-bg:#080808; }
      .hz-accent-red { --accent:#E53935; --accent-2:#FF8A87; --border:rgba(229,57,53,.28); }
      .hz-accent-blue { --accent:#2196F3; --accent-2:#73C1FF; --border:rgba(33,150,243,.28); }
      .hz-accent-purple { --accent:#9C6BFF; --accent-2:#C2A8FF; --border:rgba(156,107,255,.3); }
      .hz-theme-light.hz-accent-red { --accent:#DC2626; --accent-2:#EF4444; --accent-dark:#B91C1C; }
      .hz-theme-light.hz-accent-blue { --accent:#2563EB; --accent-2:#3B82F6; --accent-dark:#1D4ED8; }
      .hz-theme-light.hz-accent-purple { --accent:#7C3AED; --accent-2:#A78BFA; --accent-dark:#6D28D9; }
      .hz-rtl { direction: rtl; text-align: right; }
      .hz-nav { position: fixed; z-index: 100; inset: 0 0 auto; height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 0 18px; background: rgba(6,6,16,.9); backdrop-filter: blur(18px); border-bottom: 1px solid rgba(212,175,55,.15); }
      .hz-logo { display: flex; align-items: center; gap: 9px; color: #F5C842; font-family: 'Noto Serif SC', serif; font-weight: 700; font-size: 1.25rem; cursor: pointer; white-space: nowrap; }
      .hz-links { display: flex; align-items: center; gap: 4px; overflow-x: auto; scrollbar-width: none; }
      .hz-links::-webkit-scrollbar { display: none; }
      .hz-nav button, .hz-plain-button { border: 1px solid transparent; border-radius: 8px; background: transparent; color: rgba(237,232,220,.72); padding: 7px 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
      .hz-nav button.active, .hz-tab.active { background: rgba(229,57,53,.15); border-color: rgba(229,57,53,.4); color: #FF625F; }
      .hz-xp { display: flex; gap: 9px; align-items: center; white-space: nowrap; }
      .hz-bottom-nav { max-width: 1200px; margin: 10px auto 0; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 18px 20px; background: var(--nav-bg); border: 1px solid var(--border); border-radius: var(--card-radius); box-shadow: var(--shadow); }
      .hz-bottom-logo { display: flex; align-items: center; gap: 8px; color: var(--accent); font-family: 'Noto Serif SC',serif; font-weight: 900; white-space: nowrap; cursor: pointer; }
      .hz-bottom-logo span:first-child { font-size: 1.55rem; }
      .hz-bottom-links { display: flex; align-items: center; justify-content: flex-end; gap: 8px; overflow-x: auto; scrollbar-width: none; }
      .hz-bottom-links::-webkit-scrollbar { display: none; }
      .hz-bottom-nav button { border: 1px solid var(--border); border-radius: 10px; background: color-mix(in srgb, var(--card-bg), transparent 18%); color: var(--muted); padding: 8px 12px; font-weight: 900; cursor: pointer; white-space: nowrap; }
      .hz-bottom-nav button:hover, .hz-bottom-nav button.active { color: var(--accent); border-color: color-mix(in srgb, var(--accent), transparent 45%); background: color-mix(in srgb, var(--accent), transparent 88%); }
      .hz-main { animation: fadeIn .25s ease; }
      .hz-section { max-width: 1200px; margin: 0 auto; padding: 84px 20px 72px; }
      .hz-hero { min-height: 100vh; position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 88px 20px 56px; background: radial-gradient(circle at 30% 15%, rgba(229,57,53,.18), transparent 32%), radial-gradient(circle at 80% 20%, rgba(245,200,66,.14), transparent 26%), #060610; }
      .hz-float { position: absolute; color: #F5C842; font-family: 'Noto Serif SC', serif; animation: floatUp linear infinite; pointer-events: none; }
      .hz-hero-inner { position: relative; z-index: 1; width: min(1080px, 100%); text-align: center; }
      .hz-mark { font-family: 'Noto Serif SC', serif; font-size: clamp(4rem, 9vw, 6.5rem); line-height: 1; margin-bottom: 18px; background: linear-gradient(135deg,#F5C842,#E53935); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
      .hz-title { margin: 0; font-family: 'Noto Serif SC', serif; font-size: clamp(2.25rem, 6vw, 5rem); line-height: 1.12; background: linear-gradient(135deg,#F5C842,#E53935,#F5C842); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
      .hz-subtitle { color: rgba(237,232,220,.66); font-size: clamp(1rem, 2vw, 1.18rem); line-height: 1.75; max-width: 760px; margin: 18px auto 0; }
      .hz-card { background: rgba(255,255,255,.045); border: 1px solid rgba(212,175,55,.13); border-radius: var(--card-radius); backdrop-filter: blur(10px); box-shadow: var(--shadow); }
      .hz-card.hover { transition: transform .2s, border-color .2s; }
      .hz-card.hover:hover { transform: translateY(-3px); border-color: rgba(245,200,66,.35); }
      .hz-reading-nav { margin-top: 24px; padding: 16px; display: grid; grid-template-columns: minmax(140px,1fr) auto minmax(140px,1fr); gap: 12px; align-items: center; }
      .hz-gold-btn, .hz-red-btn { border: 0; border-radius: 10px; cursor: pointer; font-weight: 800; padding: 11px 20px; }
      .hz-gold-btn { background: linear-gradient(135deg,#F5C842,#E8A020); color: #060610; box-shadow: 0 4px 20px rgba(245,200,66,.28); }
      .hz-red-btn { background: linear-gradient(135deg,#E53935,#C62828); color: white; box-shadow: 0 4px 15px rgba(229,57,53,.26); }
      .hz-tab:disabled, .hz-gold-btn:disabled, .hz-red-btn:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
      .hz-nav .hz-gold-btn { background: linear-gradient(135deg,#F5C842,#E8A020); color: #060610; border-color: transparent; }
      .hz-heading { margin: 0 0 8px; font: 700 2rem/1.2 'Noto Serif SC', serif; background: linear-gradient(135deg,#F5C842,#E8A020); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
      .hz-muted { color: rgba(237,232,220,.58); line-height: 1.7; font-size: .92rem; }
      .hz-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 22px 0; }
      .hz-toolbar .push { margin-left: auto; }
      .hz-tab { border: 1px solid rgba(255,255,255,.11); border-radius: 8px; background: rgba(255,255,255,.045); color: rgba(237,232,220,.7); padding: 8px 13px; font-weight: 800; cursor: pointer; }
      .hz-audio-control { height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 8px 13px !important; border: 1px solid rgba(245,200,66,.34) !important; border-radius: 8px !important; background: rgba(8,9,18,.82) !important; color: rgba(237,232,220,.72) !important; box-shadow: none !important; font-size: .84rem; font-weight: 800; cursor: pointer; white-space: nowrap; }
      .hz-audio-control:hover { color: rgba(245,200,66,.92) !important; border-color: rgba(245,200,66,.6) !important; background: rgba(245,200,66,.08) !important; transform: translateY(-1px); }
      .hz-audio-control.active { color: var(--accent) !important; border-color: rgba(245,200,66,.68) !important; background: rgba(245,200,66,.1) !important; }
      .hz-input { width: 100%; border: 1px solid rgba(212,175,55,.22); border-radius: 10px; background: rgba(255,255,255,.06); color: #EDE8DC; outline: 0; padding: 11px 13px; font: .9rem 'Noto Sans SC', sans-serif; }
      .hz-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(250px,1fr)); gap: 14px; }
      .hz-two-col { display: grid; grid-template-columns: minmax(0,1fr) 380px; gap: 22px; align-items: start; }
      .hz-layout { display: flex; gap: 22px; align-items: flex-start; }
      .hz-sidebar { width: 290px; flex: 0 0 auto; }
      .hz-badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 2px 8px; font-size: .7rem; font-weight: 800; white-space: nowrap; }
      .hz-word-chip { display: inline-block; color: #F5C842; font-weight: 700; padding: 2px 4px; border-radius: 4px; cursor: pointer; }
      .hz-word-chip:hover { background: rgba(229,57,53,.2); }
      .hz-smart-text { position: relative; white-space: pre-wrap; }
      .hz-smart-word { display: inline-block; border-radius: 5px; padding: 0 2px; cursor: pointer; transition: background .16s ease, color .16s ease, box-shadow .16s ease; }
      .hz-smart-word:hover { background: rgba(245,200,66,.14); box-shadow: 0 0 0 1px rgba(245,200,66,.18); }
      .hz-smart-word.active { background: rgba(245,200,66,.24); color: var(--accent); box-shadow: 0 0 0 1px rgba(245,200,66,.34); }
      .hz-audio-btn { position: relative; overflow: hidden; border-color: rgba(245,200,66,.28) !important; box-shadow: 0 0 0 rgba(245,200,66,0); transition: box-shadow .18s ease, border-color .18s ease, transform .18s ease; }
      .hz-tab:has(.hz-audio-label), .hz-gold-btn:has(.hz-audio-label) { position: relative; overflow: hidden; border-color: rgba(245,200,66,.28) !important; box-shadow: 0 0 0 rgba(245,200,66,0); transition: box-shadow .18s ease, border-color .18s ease, transform .18s ease; }
      .hz-tab:has(.hz-audio-label):hover, .hz-gold-btn:has(.hz-audio-label):hover { border-color: rgba(245,200,66,.55) !important; box-shadow: 0 0 18px rgba(245,200,66,.12); transform: translateY(-1px); }
      .hz-tab:has(.hz-wave), .hz-gold-btn:has(.hz-wave) { color: var(--accent) !important; border-color: rgba(245,200,66,.68) !important; box-shadow: 0 0 22px rgba(245,200,66,.18), inset 0 0 16px rgba(118,112,255,.08); }
      .hz-audio-btn:hover { border-color: rgba(245,200,66,.55) !important; box-shadow: 0 0 18px rgba(245,200,66,.12); transform: translateY(-1px); }
      .hz-audio-btn.active { color: var(--accent) !important; border-color: rgba(245,200,66,.68) !important; box-shadow: 0 0 22px rgba(245,200,66,.18), inset 0 0 16px rgba(118,112,255,.08); }
      .hz-audio-label { display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
      .hz-wave { display: inline-flex; align-items: end; gap: 2px; height: 13px; }
      .hz-wave i { width: 3px; height: 6px; border-radius: 999px; background: currentColor; opacity: .78; animation: hzWave .72s ease-in-out infinite; }
      .hz-wave i:nth-child(2) { height: 11px; animation-delay: .1s; }
      .hz-wave i:nth-child(3) { height: 8px; animation-delay: .2s; }
      .hz-audio-loading { width: 12px; height: 12px; border-radius: 999px; border: 2px solid rgba(245,200,66,.3); border-top-color: var(--accent); animation: spin .7s linear infinite; }
      .hz-speaker-dot { width: 8px; height: 8px; border-radius: 999px; background: #33E1A0; box-shadow: 0 0 12px rgba(51,225,160,.7); }
      .hz-audio-notice { position: fixed; right: 18px; bottom: 18px; z-index: 100000; max-width: min(360px, calc(100vw - 36px)); padding: 10px 13px; border-radius: 10px; border: 1px solid rgba(245,200,66,.34); background: rgba(11,12,24,.94); color: rgba(237,232,220,.86); box-shadow: 0 16px 42px rgba(0,0,0,.34); font-size: .82rem; animation: lookupFade .18s ease-out; }
      @keyframes hzWave { 0%,100% { transform: scaleY(.55); opacity: .55; } 50% { transform: scaleY(1.15); opacity: 1; } }
      @keyframes spin { to { transform: rotate(360deg); } }
      .hz-lookup-popover { position: fixed; z-index: 99999; width: min(260px, calc(100vw - 24px)); max-height: min(220px, calc(100vh - 24px)); overflow-y: auto; padding: 12px 48px 12px 13px; border-radius: 12px; background: rgba(11,12,24,.97); border: 1px solid rgba(118,112,255,.5); box-shadow: 0 14px 34px rgba(0,0,0,.44), 0 0 0 1px rgba(245,200,66,.08); color: var(--text); animation: lookupFade .14s ease-out; }
      .hz-lookup-word { color: var(--accent); font: 800 1.55rem/1.1 'Noto Serif SC',serif; }
      .hz-lookup-pinyin { color: rgba(245,200,66,.82); font-size: .84rem; font-weight: 800; margin-top: 4px; }
      .hz-lookup-meaning { color: rgba(237,232,220,.86); font-size: .88rem; line-height: 1.45; margin-top: 7px; }
      .hz-lookup-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 11px; color: rgba(237,232,220,.55); font-size: .76rem; text-transform: lowercase; }
      .hz-lookup-badge { position: absolute; right: 10px; top: 10px; border-radius: 999px; padding: 2px 7px; border: 1px solid rgba(118,112,255,.42); background: rgba(118,112,255,.14); color: rgba(237,232,220,.76); font-size: .68rem; font-weight: 900; pointer-events: none; }
      .hz-lookup-audio { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 999px; border: 1px solid rgba(245,200,66,.32); background: rgba(245,200,66,.08); color: var(--accent); cursor: pointer; }
      .hz-lookup-close { position: absolute; top: 6px; right: 7px; border: 0; background: transparent; color: rgba(237,232,220,.45); cursor: pointer; font-size: .9rem; }
      @keyframes lookupFade { from { opacity: 0; transform: translateY(4px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .hz-flash-wrap { perspective: 1000px; width: min(390px, 92vw); height: 255px; cursor: pointer; }
      .hz-flash-inner { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform .55s; }
      .hz-flash-inner.flipped { transform: rotateY(180deg); }
      .hz-flash-side { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 20px; backface-visibility: hidden; }
      .hz-flash-back { transform: rotateY(180deg); background: rgba(229,57,53,.055); border-color: rgba(229,57,53,.42); }
      .hz-chat { height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 22px; }
      .hz-bubble { max-width: 78%; padding: 12px 15px; border-radius: 16px 16px 16px 4px; background: rgba(255,255,255,.055); border: 1px solid rgba(212,175,55,.15); white-space: pre-wrap; line-height: 1.65; font-size: .9rem; }
      .hz-bubble.user { align-self: flex-end; border-radius: 16px 16px 4px 16px; background: linear-gradient(135deg,rgba(229,57,53,.22),rgba(229,57,53,.1)); border-color: rgba(229,57,53,.3); }
      .hz-auth-wrap { min-height: calc(100vh - 64px); display: grid; place-items: center; padding: 96px 20px 72px; }
      .hz-auth-card { width: min(940px, 100%); display: grid; grid-template-columns: minmax(0,1fr) 380px; overflow: hidden; }
      .hz-auth-panel { padding: 30px; }
      .hz-auth-side { padding: 30px; border-left: 1px solid rgba(212,175,55,.14); background: linear-gradient(135deg,rgba(229,57,53,.08),rgba(245,200,66,.05)); }
      .hz-form-row { display: flex; flex-direction: column; gap: 7px; margin-bottom: 14px; }
      .hz-label { color: rgba(237,232,220,.68); font-size: .78rem; font-weight: 800; }
      .hz-error { border: 1px solid rgba(229,57,53,.35); background: rgba(229,57,53,.1); color: #FF8A87; border-radius: 10px; padding: 10px 12px; font-size: .84rem; line-height: 1.5; }
      .hz-success { border: 1px solid rgba(76,175,125,.35); background: rgba(76,175,125,.1); color: #8FE0B7; border-radius: 10px; padding: 10px 12px; font-size: .84rem; line-height: 1.5; }
      .hz-choice-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap: 10px; }
      .hz-choice { border: 1px solid rgba(255,255,255,.12); border-radius: 10px; background: rgba(255,255,255,.045); color: rgba(237,232,220,.74); padding: 11px 12px; cursor: pointer; font-weight: 800; text-align: center; }
      .hz-choice.active { border-color: rgba(245,200,66,.65); background: rgba(245,200,66,.14); color: #F5C842; }
      .hz-plan-card { position: relative; display: flex; flex-direction: column; min-height: 100%; padding: 22px; overflow: hidden; }
      .hz-plan-card.featured { border-color: rgba(245,200,66,.62); background: linear-gradient(135deg,rgba(245,200,66,.12),rgba(229,57,53,.07)); }
      .hz-plan-badge { position: absolute; top: 14px; right: 14px; border-radius: 999px; padding: 4px 9px; background: rgba(245,200,66,.18); color: #F5C842; border: 1px solid rgba(245,200,66,.45); font-size: .72rem; font-weight: 900; }
      .hz-feature-list { list-style: none; padding: 0; margin: 16px 0 22px; display: grid; gap: 9px; color: rgba(237,232,220,.72); font-size: .86rem; line-height: 1.45; }
      .hz-feature-list li::before { content: "✓"; color: #F5C842; font-weight: 900; margin-right: 8px; }
      .hz-premium-gate { min-height: calc(100vh - 64px); display: grid; place-items: center; padding: 96px 20px 72px; }
      .hz-payment-method { text-align: left; border: 1px solid rgba(255,255,255,.11); border-radius: 10px; background: rgba(255,255,255,.045); color: rgba(237,232,220,.78); padding: 13px 14px; cursor: pointer; font-weight: 800; }
      .hz-payment-method.active { border-color: rgba(245,200,66,.62); color: #F5C842; background: rgba(245,200,66,.12); }
      .hz-app .hz-nav { background: var(--nav-bg); border-bottom-color: var(--border); }
      .hz-app .hz-logo, .hz-app .hz-heading, .hz-app .hz-muted b { color: var(--accent); }
      .hz-app .hz-card { background: var(--card-bg); border-color: var(--border); color: var(--text); }
      .hz-app .hz-settings-panel { background: var(--panel-bg); border-color: var(--border); }
      .hz-app .hz-muted { color: var(--muted); }
      .hz-app .hz-input { background: var(--input-bg); color: var(--text); border-color: var(--border); }
      .hz-app select option { background: var(--option-bg); color: var(--text); }
      .hz-app .hz-tab { background: color-mix(in srgb, var(--card-bg), transparent 20%); color: var(--muted); border-color: color-mix(in srgb, var(--border), transparent 10%); }
      .hz-app .hz-tab.active, .hz-app .hz-settings-nav.active, .hz-app .hz-settings-nav:hover { color: var(--accent); border-color: color-mix(in srgb, var(--accent), transparent 55%); background: color-mix(in srgb, var(--accent), transparent 88%); }
      .hz-app .hz-gold-btn { background: linear-gradient(135deg,var(--accent),var(--accent-2)); color: var(--button-text); box-shadow: 0 4px 20px color-mix(in srgb, var(--accent), transparent 72%); }
      .hz-app .hz-red-btn { background: linear-gradient(135deg,var(--danger),var(--danger-2)); }
      .hz-app .hz-badge, .hz-app .hz-word-chip { color: var(--accent); }
      .hz-app .hz-bubble { background: color-mix(in srgb, var(--card-bg), var(--accent) 5%); border-color: var(--border); color: var(--text); }
      .hz-app .hz-bubble.user { background: linear-gradient(135deg,color-mix(in srgb, var(--danger), transparent 76%),color-mix(in srgb, var(--accent), transparent 88%)); border-color: color-mix(in srgb, var(--danger), transparent 64%); }
      .hz-app .hz-plan-card.featured, .hz-app .hz-settings-preview { border-color: color-mix(in srgb, var(--accent), transparent 40%); background: linear-gradient(135deg,color-mix(in srgb, var(--accent), transparent 88%),color-mix(in srgb, var(--danger), transparent 94%)); }
      .hz-app .hz-plan-badge { color: var(--accent); border-color: color-mix(in srgb, var(--accent), transparent 55%); background: color-mix(in srgb, var(--accent), transparent 84%); }
      .hz-app .hz-switch.on { background: color-mix(in srgb, var(--accent), transparent 75%); border-color: color-mix(in srgb, var(--accent), transparent 45%); }
      .hz-app .hz-switch.on span { background: var(--accent); }
      .hz-app .hz-payment-method.active { color: var(--accent); border-color: color-mix(in srgb, var(--accent), transparent 45%); background: color-mix(in srgb, var(--accent), transparent 88%); }
      .hz-app .hz-heading, .hz-app .hz-title, .hz-app .hz-mark { background: linear-gradient(135deg,var(--accent),var(--danger),var(--accent)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
      .hz-app footer { background: var(--footer-bg); color: var(--muted) !important; border-top-color: var(--border) !important; }
      .hz-theme-light .hz-nav { box-shadow: 0 2px 12px rgba(31,41,55,.05); }
      .hz-theme-light .hz-nav button { color: #1F2937; border-radius: 0; border-width: 0 0 2px 0; border-bottom-color: transparent; background: transparent; }
      .hz-theme-light .hz-nav button:hover { color: var(--accent-dark); background: rgba(212,160,23,.08); }
      .hz-theme-light .hz-nav button.active { color: var(--accent-dark); background: transparent; border-bottom-color: var(--accent); }
      .hz-theme-light .hz-nav .hz-gold-btn { border: 0; border-radius: 10px; background: var(--accent); color: #111827; }
      .hz-theme-light .hz-nav .hz-gold-btn:hover { background: var(--accent-dark); color: #111827; }
      .hz-theme-light .hz-bottom-nav { background: #FCFAF5; box-shadow: 0 4px 12px rgba(31,41,55,.05); }
      .hz-theme-light .hz-bottom-nav button { background: #FFFFFF; color: #4B5563; border-color: #D1D5DB; }
      .hz-theme-light .hz-bottom-nav button:hover, .hz-theme-light .hz-bottom-nav button.active { color: var(--accent-dark); border-color: var(--accent); background: #FFF7DC; }
      .hz-theme-light .hz-heading { background: none; -webkit-text-fill-color: var(--heading); color: var(--heading); }
      .hz-theme-light .hz-card.hover:hover { border-color: rgba(212,160,23,.42); box-shadow: 0 8px 20px rgba(0,0,0,.08); }
      .hz-theme-light .hz-tab { background: #FFFFFF; color: #4B5563; border-color: #E5E7EB; }
      .hz-theme-light .hz-tab:hover { color: var(--accent-dark); border-color: var(--accent); background: #FFFDF8; }
      .hz-theme-light .hz-tab.active { color: var(--accent-dark); border-color: var(--accent); background: #FFF7DC; }
      .hz-theme-light .hz-gold-btn { background: var(--accent); color: #111827; box-shadow: 0 6px 16px rgba(212,160,23,.24); }
      .hz-theme-light .hz-gold-btn:hover { background: var(--accent-dark); }
      .hz-theme-light .hz-red-btn { background: #DC2626; color: #FFFFFF; box-shadow: 0 6px 16px rgba(220,38,38,.2); }
      .hz-theme-light .hz-bubble { background: #FFFFFF; border-color: #E5E7EB; color: #1F2937; box-shadow: 0 3px 10px rgba(0,0,0,.05); }
      .hz-theme-light .hz-bubble.user { background: #FFF7DC; border-color: rgba(212,160,23,.35); color: #1F2937; }
      .hz-theme-light .hz-word-chip { color: #D4A017; background: rgba(212,160,23,.08); }
      .hz-theme-light .hz-word-chip:hover { color: #B8860B; background: rgba(212,160,23,.18); }
      .hz-theme-light .hz-feature-list { color: #4B5563; }
      .hz-theme-light .hz-feature-list li::before { color: var(--accent); }
      .hz-theme-light .hz-choice { background: #FFFFFF; color: #4B5563; border-color: #E5E7EB; }
      .hz-theme-light .hz-choice.active { color: #B8860B; background: #FFF7DC; border-color: #D4A017; }
      .hz-theme-light .hz-input::placeholder { color: #9CA3AF; }
      .hz-theme-light .hz-hero { background: radial-gradient(circle at 28% 12%, rgba(244,197,66,.28), transparent 28%), radial-gradient(circle at 78% 20%, rgba(37,99,235,.10), transparent 26%), #F8F6F1; }
      .hz-theme-light .hz-subtitle { color: #4B5563; }
      .hz-theme-light .hz-title { background: linear-gradient(135deg,#1F2937,#D4A017,#1F2937); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
      .hz-theme-light .hz-mark { background: linear-gradient(135deg,#D4A017,#F4C542); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
      .hz-theme-light .hz-settings-panel, .hz-theme-light .hz-auth-side, .hz-theme-light .hz-flash-back { background: var(--secondary-card-bg); }
      .hz-theme-light .hz-error { background: #FEF2F2; color: #B91C1C; border-color: #FCA5A5; }
      .hz-reading-text { font: 1.18rem/2.25 'Noto Serif SC',serif; letter-spacing: .04em; color: rgba(237,232,220,.88); }
      .hz-reading-pinyin { margin-bottom: 12px; }
      .hz-reading-translation { margin-top: 22px; padding-top: 18px; border-top: 1px solid rgba(212,175,55,.15); }
      .hz-theme-light .hz-reading-text { color: #111827; }
      .hz-theme-light .hz-reading-pinyin { color: #6B7280; }
      .hz-theme-light .hz-reading-translation { color: #374151; border-top-color: #E5E7EB; }
      .hz-settings-shell { display: grid; grid-template-columns: 260px minmax(0,1fr); gap: 20px; align-items: start; margin-top: 24px; }
      .hz-settings-sidebar { position: sticky; top: 84px; padding: 10px; display: grid; gap: 6px; max-height: calc(100vh - 104px); overflow-y: auto; }
      .hz-settings-nav { width: 100%; text-align: left; border: 1px solid transparent; border-radius: 10px; background: transparent; color: rgba(237,232,220,.66); padding: 10px 12px; font-weight: 800; cursor: pointer; transition: background .2s, color .2s, border-color .2s; }
      .hz-settings-nav.active, .hz-settings-nav:hover { color: #F5C842; background: rgba(245,200,66,.1); border-color: rgba(245,200,66,.26); }
      .hz-settings-panel { padding: 24px; animation: fadeIn .22s ease; }
      .hz-settings-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(230px,1fr)); gap: 14px; }
      .hz-setting-row { display: flex; flex-direction: column; gap: 7px; }
      .hz-setting-row span { color: rgba(237,232,220,.66); font-size: .78rem; font-weight: 900; }
      .hz-switch-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,.06); }
      .hz-switch { width: 46px; height: 26px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.08); padding: 3px; cursor: pointer; flex: 0 0 auto; }
      .hz-switch.on { background: rgba(245,200,66,.25); border-color: rgba(245,200,66,.55); }
      .hz-switch span { display: block; width: 18px; height: 18px; border-radius: 50%; background: rgba(237,232,220,.72); transition: transform .2s, background .2s; }
      .hz-switch.on span { transform: translateX(19px); background: #F5C842; }
      .hz-avatar-preview { width: 76px; height: 76px; border-radius: 50%; display: grid; place-items: center; color: #060610; font-weight: 900; font-size: 1.55rem; background: linear-gradient(135deg,#F5C842,#E53935); overflow: hidden; border: 1px solid rgba(245,200,66,.45); }
      .hz-avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
      .hz-settings-preview { border-color: rgba(245,200,66,.24); background: linear-gradient(135deg,rgba(245,200,66,.08),rgba(229,57,53,.06)); }
      .hz-danger-zone { border-color: rgba(229,57,53,.32); background: rgba(229,57,53,.07); }
      .hz-theme-light { background: #F8F6F1; color: #1F2937; }
      .hz-theme-light .hz-section { background: #F8F6F1; color: #1F2937; }
      .hz-theme-light .hz-card { background: #FFFFFF; border-color: #D1D5DB; color: #1F2937; }
      .hz-theme-light .hz-muted { color: #6B7280; }
      .hz-theme-light .hz-settings-sidebar { background: #FFFDF8; border-color: #D1D5DB; }
      .hz-theme-light .hz-settings-panel { background: #FFFFFF; border-color: #D1D5DB; color: #1F2937; }
      .hz-theme-light .hz-settings-preview { background: #FFFFFF; border-color: #D1D5DB; }
      .hz-theme-light .hz-settings-nav { color: #6B7280; background: transparent; border-color: transparent; }
      .hz-theme-light .hz-settings-nav:hover { color: #DC2626; background: #FDECEC; border-color: #FCA5A5; }
      .hz-theme-light .hz-settings-nav.active { color: #DC2626; background: #FDECEC; border-color: #FCA5A5; }
      .hz-theme-light .hz-setting-row span, .hz-theme-light .hz-label { color: #374151; }
      .hz-theme-light .hz-switch-row { border-bottom-color: #E5E7EB; color: #1F2937; }
      .hz-theme-light .hz-switch-row > div > div:first-child { color: #374151; }
      .hz-theme-light .hz-input { background: #FFFFFF; color: #111827; border-color: #D1D5DB; }
      .hz-theme-light .hz-input:focus { border-color: #D4A017; box-shadow: 0 0 0 3px rgba(212,160,23,.16); }
      .hz-theme-light select.hz-input option { background: #FFFFFF; color: #111827; }
      .hz-theme-light .hz-gold-btn { background: #D4A017; color: #111827; }
      .hz-theme-light .hz-red-btn { background: #DC2626; color: #FFFFFF; }
      .hz-theme-light .hz-danger-zone { background: #FEF2F2; border-color: #FCA5A5; }
      .hz-rpg-hero { margin-top: 18px; padding: 22px; border-radius: var(--card-radius); border: 1px solid color-mix(in srgb, var(--accent), transparent 55%); background: radial-gradient(circle at 12% 18%, color-mix(in srgb, var(--accent), transparent 78%), transparent 28%), linear-gradient(135deg,color-mix(in srgb, var(--card-bg), var(--accent) 8%),color-mix(in srgb, var(--card-bg), var(--danger) 5%)); box-shadow: var(--shadow); display: grid; grid-template-columns: minmax(240px,1.8fr) repeat(4,minmax(120px,1fr)); gap: 14px; align-items: stretch; }
      .hz-rpg-stat { border: 1px solid var(--border); border-radius: 12px; background: color-mix(in srgb, var(--card-bg), transparent 12%); padding: 16px; display: grid; place-items: center; text-align: center; }
      .hz-rpg-stat b { color: var(--accent); font-size: 1.7rem; }
      .hz-rpg-stat span { color: var(--muted); font-size: .8rem; font-weight: 800; }
      .hz-rpg-bar { height: 10px; background: color-mix(in srgb, var(--muted), transparent 84%); border-radius: 999px; overflow: hidden; margin-top: 10px; }
      .hz-rpg-bar.small { height: 7px; margin: 6px 0; }
      .hz-rpg-bar span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg,var(--danger),var(--accent)); transition: width .35s ease; }
      .hz-rpg-toast { margin-top: 12px; padding: 12px 14px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--accent), transparent 50%); background: color-mix(in srgb, var(--accent), transparent 88%); color: var(--text); font-weight: 900; animation: lookupFade .2s ease-out; }
      .hz-map-path { display: grid; grid-template-columns: repeat(6,1fr); gap: 8px; }
      .hz-map-node { min-height: 92px; border: 1px solid var(--border); border-radius: 12px; display: grid; place-items: center; text-align: center; background: color-mix(in srgb, var(--card-bg), transparent 8%); color: var(--muted); padding: 8px; }
      .hz-map-node span { font: 800 1.55rem 'Noto Serif SC',serif; color: color-mix(in srgb, var(--accent), transparent 45%); }
      .hz-map-node.active { border-color: color-mix(in srgb, var(--accent), transparent 30%); color: var(--text); box-shadow: 0 0 22px color-mix(in srgb, var(--accent), transparent 84%); }
      .hz-map-node.active span, .hz-map-node.done span { color: var(--accent); }
      .hz-map-node.done { background: color-mix(in srgb, var(--accent), transparent 90%); color: var(--text); }
      .hz-shop-item { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: color-mix(in srgb, var(--card-bg), transparent 8%); }
      .hz-shop-item span { color: var(--accent); font-weight: 900; white-space: nowrap; }
      @media (max-width: 920px) { .hz-two-col { grid-template-columns: 1fr; } .hz-layout { flex-direction: column; } .hz-sidebar { width: 100%; } }
      @media (max-width: 920px) { .hz-rpg-hero { grid-template-columns: 1fr 1fr; } .hz-map-path { grid-template-columns: repeat(3,1fr); } }
      @media (max-width: 920px) { .hz-settings-shell { grid-template-columns: 1fr; } .hz-settings-sidebar { position: static; max-height: none; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); } }
      @media (max-width: 820px) { .hz-auth-card { grid-template-columns: 1fr; } .hz-auth-side { border-left: 0; border-top: 1px solid rgba(212,175,55,.14); } }
      @media (max-width: 720px) { .hz-nav { padding-inline: 12px; } .hz-logo span:last-child { display: none; } .hz-xp { gap: 6px; } .hz-xp .hz-card { display: none; } .hz-xp .hz-tab, .hz-xp .hz-gold-btn { padding: 7px 9px; } .hz-grid { grid-template-columns: 1fr; } .hz-section { padding-inline: 14px; } .hz-reading-nav { grid-template-columns: 1fr; } .hz-bottom-nav { align-items: stretch; flex-direction: column; gap: 10px; margin-inline: 14px; padding: 14px; } .hz-bottom-logo { justify-content: center; } .hz-bottom-links { justify-content: flex-start; width: 100%; } .hz-bottom-nav button { padding: 8px 10px; font-size: .78rem; } }
    `}</style>
  );
}

function LevelBadge({ level }) {
  const color = levelColor(level);
  return <span className="hz-badge" style={{ color, background: `${color}24`, border: `1px solid ${color}55` }}>HSK {level}</span>;
}

function Hero({ setPage, user, onSignup, onSelectVocabLevel }) {
  const chars = useMemo(
    () => ["汉", "字", "学", "语", "文", "书", "道", "智", "美", "声", "词", "读"].map((char) => ({
      char,
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: 1.8 + Math.random() * 3.2,
      duration: 10 + Math.random() * 12,
      delay: -Math.random() * 12,
    })),
    []
  );
  const stats = [
    [totalWords().toLocaleString(), "HSK words"],
    [GRAMMAR_CURRICULUM.length, "grammar points"],
    [VERIFIED_READINGS.length, "reading texts"],
    ["HSK 1-4", "coverage"],
  ];

  return (
    <section className="hz-hero">
      {chars.map((item, index) => (
        <span
          key={`${item.char}-${index}`}
          className="hz-float"
          style={{ left: `${item.left}%`, top: `${item.top}%`, fontSize: `${item.size}rem`, animationDuration: `${item.duration}s`, animationDelay: `${item.delay}s` }}
        >
          {item.char}
        </span>
      ))}
      <div className="hz-hero-inner">
        <div className="hz-mark">汉智</div>
        <h1 className="hz-title">HanZi AI<br />Master Chinese the Intelligent Way</h1>
        <p className="hz-subtitle">A complete HSK 1-5 learning workspace with real vocabulary, flashcards, grammar lessons, graded reading, and guided practice.</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
          <button className="hz-gold-btn" onClick={() => user ? setPage("vocab") : onSignup()}>Start Learning</button>
          <button className="hz-tab active" onClick={() => user ? setPage("reading") : onSignup()}>Try Reading Mode</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginTop: 36 }}>
          {stats.map(([value, label]) => (
            <div key={label} className="hz-card" style={{ padding: 16 }}>
              <div style={{ color: "#F5C842", fontSize: "1.45rem", fontWeight: 800 }}>{value}</div>
              <div className="hz-muted" style={{ fontSize: ".78rem" }}>{label}</div>
            </div>
          ))}
        </div>
        <div className="hz-grid" style={{ marginTop: 28 }}>
          {LEVELS.map((level) => (
            <button key={level} className="hz-card hover" style={{ padding: 18, cursor: "pointer", color: "inherit", textAlign: "center" }} onClick={() => user ? onSelectVocabLevel(level) : onSignup()}>
              <div style={{ color: levelColor(level), fontSize: "1.45rem", fontWeight: 800 }}>HSK {level}</div>
              <div className="hz-muted">{wordsForLevel(level).length} vocabulary cards</div>
            </button>
          ))}
        </div>
        {!user && (
          <>
            <div className="hz-grid" style={{ marginTop: 28 }}>
              {["AI roadmap", "Smart flashcards", "Speaking coach", "Real HSK exam mode", "Analytics dashboard", "Daily Chinese news"].map((item) => (
                <div key={item} className="hz-card" style={{ padding: 18 }}>
                  <b style={{ color: "#F5C842" }}>{item}</b>
                  <div className="hz-muted">Preview the premium learning system after creating your account.</div>
                </div>
              ))}
            </div>
            <div className="hz-grid" style={{ marginTop: 28 }}>
              {SUBSCRIPTION_PLANS.map((plan) => (
                <div key={plan.id} className="hz-card" style={{ padding: 20 }}>
                  <h3 style={{ color: "#F5C842", marginTop: 0 }}>{plan.name}</h3>
                  <div className="hz-muted">{plan.features.slice(0, 5).join(" · ")}</div>
                  <button className="hz-gold-btn" style={{ marginTop: 14 }} onClick={onSignup}>Start 7-day free trial</button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Vocabulary({ onActivity, premium = false, onUpgrade, settings = createDefaultSettings(), selectedLevel = 1, onSelectedLevelChange }) {
  const [level, setLevel] = useState(selectedLevel || 1);
  const [mode, setMode] = useState("grid");
  const [query, setQuery] = useState("");
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [selected, setSelected] = useState(null);
  const [saved, setSaved] = useState(() => new Set());
  const speak = useChineseSpeech(settings);

  useEffect(() => {
    const nextLevel = LEVELS.includes(Number(selectedLevel)) ? Number(selectedLevel) : 1;
    setLevel(nextLevel);
    setCardIndex(0);
    setFlipped(false);
    setSelected(null);
  }, [selectedLevel]);

  const fullWords = useMemo(() => wordsForLevel(level), [level]);
  const words = useMemo(() => (premium || query.trim() ? fullWords : fullWords.slice(0, Math.min(20, fullWords.length))), [fullWords, premium, query]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return words;
    const score = (word) => {
      const pinyin = word.pinyin.toLowerCase();
      const meaning = word.meaning.toLowerCase();
      const meaningParts = meaning.split(/[;/,()]+/).map((part) => part.trim());
      if (word.char === q) return 0;
      if (pinyin === q) return 1;
      if (meaningParts.includes(q)) return 2;
      if (meaningParts.some((part) => part.startsWith(q))) return 3;
      if (word.char.includes(q)) return 4;
      if (pinyin.includes(q)) return 5;
      if (meaning.includes(q)) return 6;
      if ((word.tags || []).some((tag) => tag.toLowerCase().includes(q))) return 7;
      return 99;
    };
    return words
      .map((word) => ({ word, rank: score(word) }))
      .filter((item) => item.rank < 99)
      .sort((a, b) => a.rank - b.rank || a.word.difficulty - b.word.difficulty || a.word.char.length - b.word.char.length)
      .map((item) => item.word);
  }, [query, words]);

  useEffect(() => {
    setCardIndex(0);
    setFlipped(false);
    setSelected(null);
  }, [level, query, mode]);

  const safeCardIndex = filtered.length ? Math.min(cardIndex, filtered.length - 1) : 0;
  const card = filtered.length ? filtered[safeCardIndex] : null;
  const toggleSave = (id) => setSaved((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const speakChinese = (text, key = `vocab-${text}`) => speak(text, settings.audio.voiceSpeed || 0.85, key);
  const previousCard = () => {
    if (safeCardIndex <= 0) return;
    setCardIndex((index) => Math.max(0, index - 1));
    setFlipped(false);
  };
  const nextCard = () => {
    if (!card || safeCardIndex >= filtered.length - 1) return;
    onActivity?.("flashcard", { word: card });
    if (settings.study.autoPlayPronunciation) speakChinese(card.char);
    setCardIndex((index) => Math.min(filtered.length - 1, index + 1));
    setFlipped(false);
  };
  const selectLevel = (nextLevel) => {
    const parsed = LEVELS.includes(Number(nextLevel)) ? Number(nextLevel) : 1;
    setLevel(parsed);
    onSelectedLevelChange?.(parsed);
    setCardIndex(0);
    setFlipped(false);
    setSelected(null);
  };

  return (
    <section className="hz-section">
      <h1 className="hz-heading">Vocabulary</h1>
      <p className="hz-muted">Search and study HSK 1-5 vocabulary with grid cards and flashcards.</p>
      <div className="hz-toolbar">
        {LEVELS.map((item) => <button key={item} className={`hz-tab ${level === item ? "active" : ""}`} onClick={() => selectLevel(item)}>HSK {item} ({premium ? wordsForLevel(item).length : Math.min(20, wordsForLevel(item).length)})</button>)}
        <div className="push" style={{ display: "flex", gap: 8 }}>
          <button className={`hz-tab ${mode === "grid" ? "active" : ""}`} onClick={() => setMode("grid")}>Grid</button>
          <button className={`hz-tab ${mode === "flash" ? "active" : ""}`} onClick={() => setMode("flash")}>Flashcards</button>
        </div>
        <input className="hz-input" style={{ width: 280 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search hanzi, pinyin, meaning, tag..." />
      </div>
      {!premium && (
        <div className="hz-card" style={{ padding: 14, marginBottom: 18, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span className="hz-muted">Free access shows the first 20 cards per HSK level. Upgrade for full HSK 1-4 vocabulary and unlimited flashcards.</span>
          <button className="hz-gold-btn" onClick={onUpgrade}>View Plans</button>
        </div>
      )}

      {mode === "flash" ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
          {card ? (
            <>
              <div className="hz-muted">Card {safeCardIndex + 1} of {filtered.length} · click to reveal</div>
              <div className="hz-flash-wrap" onClick={() => setFlipped((value) => !value)}>
                <div className={`hz-flash-inner ${flipped ? "flipped" : ""}`}>
                  <div className="hz-card hz-flash-side">
                    <div style={{ fontFamily: "'Noto Serif SC',serif", color: "#F5C842", fontSize: "4.4rem" }}>{card.char}</div>
                    <div className="hz-muted">Tap to reveal</div>
                  </div>
                  <div className="hz-card hz-flash-side hz-flash-back">
                    <div style={{ fontFamily: "'Noto Serif SC',serif", color: "#F5C842", fontSize: "2.8rem" }}>{card.char}</div>
                    {settings.study.showPinyin && <div style={{ color: "#F5C842", fontWeight: 800 }}>{card.pinyin}</div>}
                    {settings.study.showTranslations && <div style={{ fontWeight: 800, textAlign: "center" }}>{card.meaning}</div>}
                    <button className={speak.buttonClass(`flash-${card.id}`)} onClick={(event) => { event.stopPropagation(); speakChinese(card.char, `flash-${card.id}`); }}>{speak.label(`flash-${card.id}`)}</button>
                    <div className="hz-muted" style={{ textAlign: "center", fontSize: ".8rem" }}>{card.example}</div>
                    <TagList tags={card.tags} />
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                <button className="hz-tab" disabled={safeCardIndex === 0} onClick={previousCard}>Previous</button>
                <button className="hz-red-btn" disabled={safeCardIndex >= filtered.length - 1} onClick={nextCard}>Next</button>
              </div>
            </>
          ) : <div className="hz-card" style={{ padding: 24 }}>No cards match this search.</div>}
        </div>
      ) : (
        <div className="hz-grid">
          {filtered.map((word) => (
            <article key={word.id} className="hz-card hover" style={{ padding: 18, cursor: "pointer", borderColor: selected?.id === word.id ? "rgba(229,57,53,.55)" : undefined }} onClick={() => setSelected(selected?.id === word.id ? null : word)}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ color: "#F5C842", font: "700 2rem 'Noto Serif SC',serif" }}>{word.char}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "start" }}>
                  <LevelBadge level={word.difficulty} />
                  <button className={speak.buttonClass(`word-${word.id}`)} title="Play pronunciation" onClick={(event) => { event.stopPropagation(); speakChinese(word.char, `word-${word.id}`); }}>{speak.label(`word-${word.id}`)}</button>
                  <button className="hz-plain-button" style={{ padding: "0 2px", fontSize: "1.15rem", color: saved.has(word.id) ? "#E53935" : "rgba(237,232,220,.36)" }} onClick={(event) => { event.stopPropagation(); toggleSave(word.id); }}>{saved.has(word.id) ? "♥" : "♡"}</button>
                </div>
              </div>
              {settings.study.showPinyin && <div style={{ color: "#F5C842", fontWeight: 700 }}>{word.pinyin}</div>}
              {settings.study.showTranslations && <div style={{ marginTop: 5, fontWeight: 700 }}>{word.meaning}</div>}
              {selected?.id === word.id && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(212,175,55,.15)" }}>
                  <div className="hz-muted"><InteractiveChineseText text={word.example} /></div>
                  <div className="hz-muted" style={{ fontSize: ".8rem", opacity: .78 }}>{word.exEn}</div>
                  <button className={speak.buttonClass(`study-${word.id}`)} style={{ marginTop: 8 }} onClick={(event) => { event.stopPropagation(); onActivity?.("word", { word }); speakChinese(word.char, `study-${word.id}`); }}>{speak.label(`study-${word.id}`)}</button>
                  <TagList tags={word.tags} />
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      <div className="hz-toolbar"><span className="hz-muted">{filtered.length} visible · {saved.size} saved · {words.length}{premium ? "" : ` of ${fullWords.length}`} total in HSK {level}</span></div>
    </section>
  );
}

function TagList({ tags = [] }) {
  return <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 9 }}>{tags.map((tag) => <span key={tag} className="hz-badge" style={{ color: "#F5C842", background: "rgba(245,200,66,.14)", border: "1px solid rgba(245,200,66,.3)" }}>{tag}</span>)}</div>;
}

function Reading({ onActivity, premium = false, onUpgrade, settings = createDefaultSettings() }) {
  const [level, setLevel] = useState(1);
  const passages = useMemo(() => {
    const items = VERIFIED_READINGS.filter((item) => item.level === level).slice(0, 20);
    return premium ? items : items.slice(0, 1);
  }, [level, premium]);
  const [passageId, setPassageId] = useState(passages[0]?.id);
  const passage = passages.find((item) => item.id === passageId) || passages[0] || VERIFIED_READINGS[0];
  const currentReadingIndex = Math.max(0, passages.findIndex((item) => item.id === passage?.id));
  const [showTranslation, setShowTranslation] = useState(false);
  const [showPinyin, setShowPinyin] = useState(false);
  const [tooltip, setTooltip] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const timer = useRef(null);
  const speak = useChineseSpeech(settings);
  const speakChinese = (text, rate = settings.audio.voiceSpeed || 0.85, key = `reading-${rate}`) => speak(text, rate, key);

  useEffect(() => {
    const first = passages[0];
    setPassageId(first?.id);
    setShowTranslation(false);
    setShowPinyin(false);
    setTooltip(null);
    setAnalysis(null);
  }, [level, passages]);

  const selectReading = (nextIndex) => {
    const next = passages[nextIndex];
    if (!next) return;
    setPassageId(next.id);
    setShowTranslation(false);
    setShowPinyin(false);
    setTooltip(null);
    setAnalysis(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const analyze = (sentence) => {
    const words = Object.entries(passage.words).filter(([word]) => sentence.includes(word)).map(([word, data]) => ({ word, ...data }));
    setAnalysis({
      sentence,
      words,
      note: words.length
        ? `This sentence highlights ${words.map((item) => item.grammar).slice(0, 4).join(", ")}.`
        : "No highlighted key vocabulary was found in this sentence.",
    });
  };

  const showWord = (event, word, data) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setTooltip({ word, ...data, left: Math.min(rect.left, window.innerWidth - 350), top: rect.bottom + 8 }), 130);
  };

  const renderText = () => {
    const keys = Object.keys(passage.words).sort((a, b) => b.length - a.length);
    const parts = [];
    let index = 0;
    let sentenceStart = 0;
    while (index < passage.text.length) {
      const match = keys.find((key) => passage.text.startsWith(key, index));
      if (match) {
        parts.push(<span key={parts.length} className="hz-word-chip" onMouseDown={(event) => showWord(event, match, passage.words[match])} onMouseUp={() => clearTimeout(timer.current)} onMouseLeave={() => clearTimeout(timer.current)} onTouchStart={(event) => showWord(event, match, passage.words[match])} onTouchEnd={() => clearTimeout(timer.current)}>{match}</span>);
        index += match.length;
        continue;
      }
      const char = passage.text[index];
      if ("。！？".includes(char)) {
        const sentence = passage.text.slice(sentenceStart, index + 1).trim();
        parts.push(<span key={parts.length} style={{ color: "rgba(237,232,220,.55)", cursor: "pointer", fontWeight: 800 }} onClick={(event) => { event.stopPropagation(); analyze(sentence); }}>{char}</span>);
        sentenceStart = index + 1;
      } else {
        parts.push(<span key={parts.length}>{char}</span>);
      }
      index += 1;
    }
    return parts;
  };

  if (!passage) return null;

  return (
    <section className="hz-section" onClick={() => setTooltip(null)}>
      <h1 className="hz-heading">Reading</h1>
      <p className="hz-muted">Press highlighted words for pinyin and meaning. Click punctuation to analyze a sentence.</p>
      {!premium && (
        <div className="hz-card" style={{ padding: 14, margin: "16px 0", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span className="hz-muted">Free access includes limited reading practice. Upgrade for all HSK 1-5 readings and progress analytics.</span>
          <button className="hz-gold-btn" onClick={onUpgrade}>View Plans</button>
        </div>
      )}
      <div className="hz-toolbar">
        {LEVELS.map((item) => <button key={item} className={`hz-tab ${level === item ? "active" : ""}`} onClick={() => setLevel(item)}>HSK {item}</button>)}
        <span className="hz-muted">Reading {currentReadingIndex + 1} of {passages.length}</span>
      </div>
      <div className="hz-two-col">
        <article className="hz-card" style={{ padding: 28 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "start", marginBottom: 18 }}>
            <div>
              <div style={{ color: "#F5C842", font: "700 1.55rem 'Noto Serif SC',serif" }}>{passage.title}</div>
              <div className="hz-muted">{passage.titleEn}</div>
              {passage.source?.book && <div className="hz-muted" style={{ fontSize: ".78rem" }}>Source: {passage.source.book} Lesson {passage.source.lesson}</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
              <LevelBadge level={passage.level} />
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button className="hz-tab" onClick={(event) => { event.stopPropagation(); setShowPinyin((value) => !value); }}>{showPinyin ? "Hide Pinyin" : "Show Pinyin"}</button>
                <button className="hz-tab" onClick={(event) => { event.stopPropagation(); setShowTranslation((value) => !value); }}>{showTranslation ? "Hide Translation" : "Show Translation"}</button>
              </div>
            </div>
          </div>
          {showPinyin && <div className="hz-muted hz-reading-pinyin">{passage.pinyin}</div>}
          <div className="hz-reading-text">
            <InteractiveChineseText text={passage.text} sentenceHints={passage.sentenceAnalysis || []} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
            <button className={speak.buttonClass(`reading-${passage.id}-play`)} onClick={(event) => { event.stopPropagation(); speakChinese(passage.text, settings.audio.voiceSpeed || 0.85, `reading-${passage.id}-play`); }}>{speak.label(`reading-${passage.id}-play`)}</button>
            <button className={speak.buttonClass(`reading-${passage.id}-slow`)} onClick={(event) => { event.stopPropagation(); speakChinese(passage.text, 0.65, `reading-${passage.id}-slow`); }}>{speak.label(`reading-${passage.id}-slow`, "Slow", "Stop Slow")}</button>
          </div>
          {showTranslation && <div className="hz-muted hz-reading-translation">{passage.translation}</div>}
          <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid rgba(212,175,55,.15)" }}>
            <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Comprehension Questions</h3>
            {(passage.questions || []).map((item, index) => <div key={index} className="hz-muted">{index + 1}. {item.question}</div>)}
          </div>
          <div style={{ marginTop: 18 }}>
            <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Answer Key</h3>
            {(passage.questions || []).map((item, index) => <div key={index} className="hz-muted">{index + 1}. {item.answer}</div>)}
          </div>
          <div className="hz-card hz-reading-nav">
            <button
              className="hz-tab"
              disabled={currentReadingIndex <= 0}
              style={{ padding: "13px 16px", fontSize: ".95rem" }}
              onClick={(event) => { event.stopPropagation(); selectReading(currentReadingIndex - 1); }}
            >
              Previous Reading
            </button>
            <div style={{ color: "var(--accent)", fontWeight: 900, textAlign: "center", whiteSpace: "nowrap" }}>Reading {currentReadingIndex + 1} of {passages.length}</div>
            <button
              className="hz-red-btn"
              disabled={currentReadingIndex >= passages.length - 1}
              style={{ padding: "13px 16px", fontSize: ".95rem" }}
              onClick={(event) => { event.stopPropagation(); selectReading(currentReadingIndex + 1); }}
            >
              Next Reading
            </button>
          </div>
        </article>
        <aside>
          <div className="hz-card" style={{ padding: 20 }}>
            <h3 style={{ color: "#F5C842", margin: "0 0 12px" }}>Sentence Analysis</h3>
            {analysis ? (
              <>
                <div style={{ font: "1rem/1.8 'Noto Serif SC',serif", marginBottom: 12 }}>{analysis.sentence}</div>
                <p className="hz-muted">{analysis.note}</p>
                <Breakdown words={analysis.words} />
              </>
            ) : <p className="hz-muted">Click any 。！？ punctuation mark in the passage to inspect that sentence.</p>}
          </div>
          <div className="hz-card" style={{ padding: 20, marginTop: 14 }}>
            <h3 style={{ color: "#F5C842", margin: "0 0 12px" }}>Key Vocabulary</h3>
            <Breakdown words={Object.entries(passage.words).map(([word, data]) => ({ word, ...data }))} />
          </div>
          <div className="hz-card" style={{ padding: 20, marginTop: 14 }}>
            <h3 style={{ color: "#F5C842", margin: "0 0 12px" }}>Grammar Points</h3>
            {(passage.grammarPoints || []).map((point) => <div key={point} className="hz-muted">• {point}</div>)}
          </div>
          <div className="hz-card" style={{ padding: 20, marginTop: 14 }}>
            <h3 style={{ color: "#F5C842", margin: "0 0 12px" }}>Sentence Analysis</h3>
            {(passage.sentenceAnalysis || []).map((item, index) => (
              <div key={index} style={{ marginBottom: 12 }}>
                <div style={{ font: "1rem/1.7 'Noto Serif SC',serif" }}>{item.sentence}</div>
                <div className="hz-muted">{item.note}</div>
              </div>
            ))}
          </div>
        </aside>
      </div>
      {tooltip && (
        <div className="hz-card" style={{ position: "fixed", zIndex: 1000, left: Math.max(10, tooltip.left), top: Math.min(tooltip.top, window.innerHeight - 250), width: 320, padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,.65)" }} onClick={(event) => event.stopPropagation()}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><div style={{ color: "#F5C842", font: "700 2.2rem 'Noto Serif SC',serif" }}>{tooltip.word}</div><button className="hz-plain-button" onClick={() => setTooltip(null)}>×</button></div>
          <div style={{ color: "#F5C842", fontWeight: 800, marginBottom: 8 }}>{tooltip.pinyin}</div>
          <div style={{ fontWeight: 800 }}>{tooltip.meaning}</div>
          <div className="hz-muted">{tooltip.grammar}</div>
        </div>
      )}
    </section>
  );
}

function Breakdown({ words }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 320, overflowY: "auto" }}>
      {words.map((item, index) => (
        <div key={`${item.word}-${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(54px,auto) 1fr auto", gap: 9, alignItems: "center", padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,.035)" }}>
          <span style={{ color: "#F5C842", font: "700 1.05rem 'Noto Serif SC',serif" }}>{item.word}</span>
          <span className="hz-muted" style={{ fontSize: ".78rem" }}>{item.pinyin}<br />{item.meaning}</span>
          <span style={{ display: "flex", flexDirection: "column", gap: 5, alignItems: "flex-end" }}>
            <span className="hz-badge" style={{ color: "#FF625F", background: "rgba(229,57,53,.14)", border: "1px solid rgba(229,57,53,.3)" }}>{item.grammar}</span>
            {(item.hskLevel || item.level || item.difficulty) && <span className="hz-badge" style={{ color: "#F5C842", background: "rgba(245,200,66,.1)", border: "1px solid rgba(245,200,66,.28)" }}>HSK {item.hskLevel || item.level || item.difficulty}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Grammar({ onActivity, settings = createDefaultSettings() }) {
  const [level, setLevel] = useState(0);
  const [query, setQuery] = useState("");
  const [expandedLessons, setExpandedLessons] = useState({});
  const lessons = useMemo(() => {
    const q = query.trim().toLowerCase();
    return GRAMMAR_CURRICULUM.filter((item) => {
      if (level && item.level !== level) return false;
      if (!q) return true;
      return [item.title, item.rule, item.formula].some((value) => String(value || "").toLowerCase().includes(q));
    });
  }, [level, query]);
  const [selectedId, setSelectedId] = useState(GRAMMAR_CURRICULUM[0]?.id);
  const selected = lessons.find((item) => item.id === selectedId) || lessons[0];
  const selectedIndex = Math.max(0, lessons.findIndex((item) => item.id === selected?.id));
  const visibleLevels = level ? [level] : LEVELS;
  const groupedLessons = useMemo(() => Object.fromEntries(visibleLevels.map((itemLevel) => [
    itemLevel,
    lessons.filter((lesson) => lesson.level === itemLevel),
  ])), [lessons, visibleLevels]);

  useEffect(() => {
    if (lessons[0] && !lessons.some((item) => item.id === selectedId)) setSelectedId(lessons[0].id);
  }, [lessons, selectedId]);

  const speak = useChineseSpeech(settings);
  const goLesson = (offset) => {
    const next = lessons[selectedIndex + offset];
    if (next) setSelectedId(next.id);
  };
  const toggleLesson = (lesson) => {
    setSelectedId(lesson.id);
    setExpandedLessons((current) => ({ ...current, [lesson.id]: !current[lesson.id] }));
  };

  return (
    <section className="hz-section">
      <h1 className="hz-heading">Grammar</h1>
      <p className="hz-muted">286 HSK 1-4 grammar points organized by HSK level, lesson, examples, mistakes, practice, and audio.</p>
      <div className="hz-toolbar">
        <button className={`hz-tab ${level === 0 ? "active" : ""}`} onClick={() => setLevel(0)}>All</button>
        {LEVELS.map((item) => <button key={item} className={`hz-tab ${level === item ? "active" : ""}`} onClick={() => setLevel(item)}>HSK {item}</button>)}
        <input className="hz-input" style={{ width: 260 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search grammar..." />
        <span className="hz-muted">Grammar {selectedIndex + 1} of {GRAMMAR_CURRICULUM.length}</span>
      </div>
      <div className="hz-layout">
        <aside className="hz-sidebar">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "72vh", overflowY: "auto", paddingRight: 4 }}>
            {visibleLevels.map((itemLevel) => (
              <div key={itemLevel} className="hz-card" style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <LevelBadge level={itemLevel} />
                  <span className="hz-muted">{groupedLessons[itemLevel]?.length || 0} lessons</span>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {(groupedLessons[itemLevel] || []).map((lesson) => (
                    <div key={lesson.id} className="hz-card" style={{ padding: 10, borderColor: selected?.id === lesson.id ? "rgba(229,57,53,.5)" : undefined }}>
                      <button className="hz-plain-button" style={{ width: "100%", textAlign: "left", color: "inherit", padding: 0 }} onClick={() => toggleLesson(lesson)}>
                        <div style={{ fontWeight: 900 }}>Lesson {lesson.lessonNumber}</div>
                        <div className="hz-muted">{expandedLessons[lesson.id] ? "Hide grammar points" : "Show grammar points"}</div>
                      </button>
                      {expandedLessons[lesson.id] && (
                        <button className="hz-tab" style={{ width: "100%", marginTop: 8, textAlign: "left", whiteSpace: "normal" }} onClick={() => setSelectedId(lesson.id)}>
                          {lesson.title}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
        {selected && (
          <article className="hz-card" style={{ padding: 26, flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}><LevelBadge level={selected.level} /><span className="hz-badge" style={{ color: "var(--accent)", background: "rgba(245,200,66,.12)", border: "1px solid var(--border)" }}>Lesson {selected.lessonNumber}</span><h2 style={{ color: "#F5C842", margin: 0, font: "700 1.35rem 'Noto Serif SC',serif" }}>{selected.title}</h2></div>
            <Info title="Explanation">{selected.rule}</Info>
            <Info title="Structure / Formula">{selected.formula}</Info>
            <h3 style={{ color: "rgba(237,232,220,.62)", fontSize: ".78rem", letterSpacing: ".08em" }}>EXAMPLES</h3>
            {selected.examples.map((example, index) => (
              <div key={index} className="hz-card" style={{ padding: 17, marginBottom: 12 }}>
                <div style={{ font: "1.32rem/1.55 'Noto Serif SC',serif" }}><InteractiveChineseText text={example.cn} /></div>
                <div style={{ color: "#F5C842", margin: "4px 0" }}>{example.py}</div>
                <div className="hz-muted">{example.en}</div>
                <button className={speak.buttonClass(`grammar-${selected.id}-${index}`)} style={{ marginTop: 10 }} onClick={() => speak(example.cn, 0.85, `grammar-${selected.id}-${index}`)}>{speak.label(`grammar-${selected.id}-${index}`)}</button>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  {(example.breakdown || []).map((part, i) => <div key={`${part.w}-${i}`} style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,.05)", textAlign: "center" }}><div style={{ color: "#F5C842", font: "700 1.06rem 'Noto Serif SC',serif" }}>{part.w}</div><div className="hz-muted" style={{ fontSize: ".7rem" }}>{part.r}<br />{part.t}</div></div>)}
                </div>
              </div>
            ))}
            <h3 style={{ color: "rgba(237,232,220,.62)", fontSize: ".78rem", letterSpacing: ".08em" }}>COMMON MISTAKES</h3>
            {selected.mistakes.map((mistake, index) => <div key={index} style={{ color: index === 0 ? "#E57373" : "#70C997", lineHeight: 1.7 }}>{mistake}</div>)}
            <h3 style={{ color: "rgba(237,232,220,.62)", fontSize: ".78rem", letterSpacing: ".08em" }}>PRACTICE</h3>
            {(selected.practice || []).map((item, index) => <div key={index} className="hz-muted">{index + 1}. {item.question}<br />Answer: {item.answer}</div>)}
            <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: "rgba(76,175,125,.08)", border: "1px solid rgba(76,175,125,.25)" }}><b style={{ color: "#4CAF7D" }}>Tip: </b><span className="hz-muted">{selected.tip}</span></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              <button className="hz-tab" disabled={selectedIndex <= 0} onClick={() => goLesson(-1)}>Previous Grammar Lesson</button>
              <button className="hz-red-btn" disabled={selectedIndex >= lessons.length - 1} onClick={() => goLesson(1)}>Next Grammar Lesson</button>
              <button className="hz-gold-btn" onClick={() => onActivity?.("grammar", { lesson: selected })}>Mark Lesson Viewed</button>
            </div>
          </article>
        )}
      </div>
    </section>
  );
}

function Info({ title, children }) {
  return <div style={{ padding: 16, borderRadius: 10, background: "rgba(245,200,66,.07)", border: "1px solid rgba(212,175,55,.2)", marginBottom: 20 }}><div style={{ color: "#F5C842", fontWeight: 800, fontSize: ".78rem", marginBottom: 8 }}>{title}</div><div className="hz-muted" style={{ color: "rgba(237,232,220,.84)" }}>{children}</div></div>;
}

const hasChinese = (text) => /[\u3400-\u9fff]/.test(text);
const chineseOnly = (text) => (text.match(/[\u3400-\u9fff，。！？、；：]/g) || []).join("");
const sampleItems = (items, count) => [...items].sort(() => Math.random() - 0.5).slice(0, count);
const extractHskLevel = (text) => {
  const match = text.match(/hsk\s*([1-4])|([1-4])\s*级|第\s*([1-4])\s*级/i);
  return Number(match?.[1] || match?.[2] || match?.[3] || 2);
};

function formulaForLesson(title) {
  if (title.includes("SVO")) return "Subject + Verb + Object";
  if (title.includes("是")) return "Subject + 是 + noun";
  if (title.includes("很")) return "Subject + 很 + adjective";
  if (title.includes("吗")) return "Statement + 吗？";
  if (title.includes("的 for possession")) return "Possessor + 的 + noun";
  if (title.includes("Measure")) return "Number + measure word + noun";
  if (title.includes("完成") || title.includes("了")) return "Subject + Verb + 了 + Object";
  if (title.includes("在")) return "Subject + 在 + place + verb / Subject + 在 + verb";
  if (title.includes("会")) return "Subject + 会/能/可以 + verb";
  if (title.includes("因为")) return "因为 + reason，所以 + result";
  if (title.includes("虽然")) return "虽然 + situation，但是 + contrast";
  if (title.includes("一边")) return "Subject + 一边 + action 1 + 一边 + action 2";
  if (title.includes("把")) return "Subject + 把 + object + verb + result";
  if (title.includes("被")) return "Subject + 被 + doer + verb + result";
  if (title.includes("越来越")) return "越来越 + adjective / verb phrase";
  if (title.includes("不仅")) return "不仅 + point 1，而且 + point 2";
  if (title.includes("只要")) return "只要 + condition，就 + result";
  if (title.includes("只有")) return "只有 + condition，才 + result";
  if (title.includes("无论") || title.includes("不管")) return "不管/无论 + condition，都/也 + result";
  if (title.includes("连")) return "连 + surprising item + 都/也 + predicate";
  if (title.includes("得")) return "Verb + 得 + degree/evaluation";
  return "Pattern + example + practice";
}

const makeAudio = (label, text) => ({ label, text });
const firstMeaning = (meaning) => meaning.split(/[;/]/)[0].trim();

function findVocabulary(text, vocab) {
  const lower = text.toLowerCase();
  const direct = vocab
    .filter((word) => text.includes(word.char))
    .sort((a, b) => b.char.length - a.char.length || a.difficulty - b.difficulty);
  if (direct.length) return direct.slice(0, 3);

  const pinyinOrMeaning = vocab.filter((word) => {
    const meaning = word.meaning.toLowerCase();
    const pinyin = word.pinyin.toLowerCase();
    return pinyin === lower || pinyin.includes(lower) || lower.includes(pinyin) || meaning.includes(lower) || lower.split(/\W+/).some((part) => part.length > 3 && meaning.includes(part));
  });
  return pinyinOrMeaning.slice(0, 3);
}

const normalizeTutorText = (text = "") => text
  .toString()
  .toLowerCase()
  .replace(/[’‘]/g, "'")
  .replace(/\bdiffrence\b/g, "difference")
  .replace(/\bexmpl\b/g, "example")
  .replace(/\bdidnt\b/g, "didn't")
  .replace(/\bdont\b/g, "don't")
  .replace(/\s+/g, " ")
  .trim();

const capitalizeTerm = (value = "") => value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;

const ROMANIZED_PHRASES = [
  { keys: ["wo ai ni", "woaini"], cn: "我爱你", pinyin: "wǒ ài nǐ", meaning: "I love you." },
  { keys: ["ni hao", "nihao"], cn: "你好", pinyin: "nǐ hǎo", meaning: "hello" },
  { keys: ["xie xie", "xiexie"], cn: "谢谢", pinyin: "xièxie", meaning: "thank you" },
  { keys: ["zai jian", "zaijian"], cn: "再见", pinyin: "zàijiàn", meaning: "goodbye" },
];

function findRomanizedPhrase(text) {
  const lower = normalizeTutorText(text)
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compact = lower.replace(/\s+/g, "");
  return ROMANIZED_PHRASES.find((item) =>
    item.keys.some((key) => lower.includes(key) || compact.includes(key.replace(/\s+/g, "")))
  ) || null;
}

function answerRomanizedPhrase(item) {
  return {
    reply: `${item.cn} (${item.pinyin})

Meaning:
${item.meaning}`,
    audioItems: [makeAudio(item.cn, item.cn)],
    lastTopic: { type: "sentence", sentence: item.cn },
  };
}

function answerZaiDifference() {
  return {
    reply: `在 (zài) = at / in / doing something
Example: 我在学校。= I am at school.
Example: 我在学习。= I am studying.

再 (zài) = again / then
Example: 请再说一遍。= Please say it again.
Example: 我明天再来。= I will come again tomorrow.`,
    audioItems: [
      makeAudio("在学校", "我在学校"),
      makeAudio("再说一遍", "请再说一遍"),
    ],
    lastTopic: { type: "grammar", lesson: null, point: "在 vs 再" },
  };
}

function findEnglishVocabulary(text, vocab) {
  const lower = normalizeTutorText(text);
  const exactVerified = (...chars) => chars.map((char) => vocab.find((word) => word.char === char)).find(Boolean);
  if (/\bfood\b/.test(lower)) {
    const food = exactVerified("食物", "吃的");
    if (food) {
      return {
        kind: "common",
        term: "Food",
        word: food.char,
        char: food.char,
        pinyin: food.pinyin,
        meaning: firstMeaning(food.meaning),
        examples: [{ cn: food.example, en: food.exEn }],
      };
    }
  }
  if (/\bstop\b/.test(lower)) {
    const stop = exactVerified("停", "停止");
    if (stop) {
      return {
        kind: "common",
        term: "Stop",
        word: "停 / 停止",
        char: "停",
        pinyin: "tíng / tíngzhǐ",
        meaning: "to stop",
        examples: [
          { cn: "请停一下。", en: "Please stop for a moment." },
          { cn: "请停止说话。", en: "Please stop talking." },
        ],
      };
    }
    return {
      ...exactVerified("停止"),
      kind: "common",
      term: "Stop",
    };
  }

  const match = lower.match(/(?:what(?:'s| is)?|what does|how do you say|how to say|translate|meaning of|mean(?:ing)? of)\s+(.+?)(?:\s+(?:in|to)?\s*chinese|\?|$)/);
  const term = (match?.[1] || lower)
    .replace(/\b(chinese|mandarin|word|please|tell me|the|what|is|in|to|say|how|do|you|does|mean|meaning|of)\b/g, " ")
    .replace(/[?!.:,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!term || term.length < 2) return null;

  const termParts = term.split(/\s+/).filter((part) => part.length > 2);
  const candidates = vocab
    .filter((word) => {
      const parts = word.meaning.toLowerCase().split(/[;/,()]+/).map((part) => part.trim()).filter(Boolean);
      return parts.some((part) =>
        part === term ||
        part.startsWith(`${term} `) ||
        part.includes(` ${term}`) ||
        termParts.some((piece) => part === piece || part.startsWith(`${piece} `) || part.includes(` ${piece}`))
      );
    })
    .sort((a, b) => a.difficulty - b.difficulty || a.char.length - b.char.length);
  return candidates[0] ? { ...candidates[0], lookupTerm: term } : null;
}

function pinyinForChinese(text, vocab) {
  const cn = chineseOnly(text).replace(/[，。！？、；：]/g, "");
  const word = vocab.find((item) => item.char === cn) || findVocabulary(cn, vocab)[0];
  if (word) {
    return {
      reply: `${word.char} = ${word.pinyin}`,
      audioItems: [makeAudio(word.char, word.char)],
      lastTopic: { type: "vocab", word },
    };
  }
  return {
    reply: `${cn}\n\nI do not have this exact word in the HSK 1-4 word bank, but I can still help if you ask for pronunciation or sentence correction.`,
    audioItems: cn ? [makeAudio(cn, cn)] : [],
  };
}

function answerPronunciation(text, vocab) {
  const cn = chineseOnly(text).replace(/[，。！？、；：]/g, "");
  const word = vocab.find((item) => item.char === cn) || findVocabulary(cn, vocab)[0];
  if (!word) {
    return {
      reply: "Please send the Chinese word you want to pronounce.",
      audioItems: [],
    };
  }
  const tips = {
    学校: `"xue" sounds like "shweh"\n"xiao" sounds like "shyaow"`,
    朋友: `"peng" is like "puhng"\n"you" is light and neutral here`,
    中文: `"zhong" starts with a curled zh sound\n"wen" sounds like "wuhn"`,
  };
  return {
    reply: `${word.char}

Pinyin:
${word.pinyin}

Pronunciation tip:
${tips[word.char] || "Listen to the audio, then repeat slowly. Keep the tones clear and even."}`,
    audioItems: [makeAudio(word.char, word.char), makeAudio("Audio", word.char)],
    lastTopic: { type: "vocab", word },
  };
}

function translateRequest(text) {
  const raw = text.replace(/^translate\s*:?\s*/i, "").trim();
  const lower = raw.toLowerCase().replace(/[.?!]/g, "");
  const known = [
    {
      tests: ["i want to drink water", "i would like to drink water"],
      cn: "我想喝水。",
      py: "Wǒ xiǎng hē shuǐ.",
      en: "I want to drink water.",
    },
    {
      tests: ["i study chinese every day", "i learn chinese every day"],
      cn: "我每天学习中文。",
      py: "Wǒ měitiān xuéxí Zhōngwén.",
      en: "I study Chinese every day.",
    },
    {
      tests: ["i am very busy today", "i'm very busy today"],
      cn: "我今天很忙。",
      py: "Wǒ jīntiān hěn máng.",
      en: "I am very busy today.",
    },
  ];
  const item = known.find((entry) => entry.tests.includes(lower));
  if (!item) {
    return {
      reply: "I can translate simple HSK 1-4 sentences. Try: Translate: I want to drink water.",
      audioItems: [],
    };
  }
  return {
    reply: `${item.cn}

Pinyin:
${item.py}

Meaning:
${item.en}`,
    audioItems: [makeAudio("Translation", item.cn)],
    lastTopic: { type: "translation", text: item.cn },
  };
}

function sentenceMeaning(text) {
  const cn = chineseOnly(text).replace(/[，。！？、；：]/g, "");
  const known = [
    { cn: "我今天很忙", en: "I am very busy today." },
    { cn: "我想喝水", en: "I want to drink water." },
    { cn: "我学习中文", en: "I study Chinese." },
    { cn: "我每天学习中文", en: "I study Chinese every day." },
  ];
  const item = known.find((entry) => cn.includes(entry.cn));
  if (!item) return null;
  return {
    reply: `It means:

"${item.en}"`,
    audioItems: [makeAudio("Sentence", item.cn)],
    lastTopic: { type: "sentence", sentence: item.cn },
  };
}

function findGrammar(text) {
  const lower = normalizeTutorText(text);
  if (/\b(le|liao)\b|了/.test(lower)) return GRAMMAR_LESSONS.find((lesson) => lesson.title === "了 for completed actions") || null;
  if (/\bba\b|把/.test(lower)) return GRAMMAR_LESSONS.find((lesson) => lesson.title === "把 sentence basics") || null;
  if (/\bbei\b|被/.test(lower)) return GRAMMAR_LESSONS.find((lesson) => lesson.title === "被 passive") || null;
  const patterns = [
    ["了 for completed actions", ["了", "le", "completed", "completion"]],
    ["把 sentence basics", ["把", "ba sentence"]],
    ["被 passive", ["被", "passive"]],
    ["虽然...但是...", ["虽然", "但是", "although"]],
    ["因为...所以...", ["因为", "所以", "because"]],
    ["Questions with 吗", ["吗", "yes/no question"]],
    ["Measure words", ["measure", "classifier", "量词", "个"]],
    ["越来越", ["越来越", "more and more"]],
    ["不仅...而且...", ["不仅", "而且", "not only"]],
    ["只要...就...", ["只要", "as long as"]],
    ["只有...才...", ["只有", "only if"]],
    ["无论/不管...都...", ["无论", "不管", "no matter"]],
    ["得 complement of degree", ["得", "degree complement"]],
  ];
  const special = patterns.find(([, keys]) => keys.some((key) => lower.includes(key.toLowerCase()) || text.includes(key)));
  if (special?.[0] === "的 地 得") return null;
  if (special) return GRAMMAR_LESSONS.find((lesson) => lesson.title === special[0]) || null;

  return GRAMMAR_LESSONS.find((lesson) => {
    const haystack = `${lesson.title} ${lesson.rule}`.toLowerCase();
    return lower.split(/\s+/).some((part) => part.length > 3 && haystack.includes(part));
  }) || null;
}

function exampleSentencesFor(word) {
  const special = {
    懒: [
      { cn: "他很懒。", py: "Tā hěn lǎn.", en: "He is lazy." },
      { cn: "我今天很懒，不想出门。", py: "Wǒ jīntiān hěn lǎn, bù xiǎng chūmén.", en: "I feel lazy today and do not want to go out." },
      { cn: "别这么懒，快去学习。", py: "Bié zhème lǎn, kuài qù xuéxí.", en: "Do not be so lazy. Go study." },
      { cn: "他不想做作业，因为他有点懒。", py: "Tā bù xiǎng zuò zuòyè, yīnwèi tā yǒudiǎn lǎn.", en: "He does not want to do homework because he is a little lazy." },
      { cn: "周末我太懒了，只想在家睡觉。", py: "Zhōumò wǒ tài lǎn le, zhǐ xiǎng zài jiā shuìjiào.", en: "On the weekend I was too lazy and only wanted to sleep at home." },
      { cn: "如果你一直这么懒，中文很难进步。", py: "Rúguǒ nǐ yìzhí zhème lǎn, Zhōngwén hěn nán jìnbù.", en: "If you stay this lazy, your Chinese will be hard to improve." },
      { cn: "他不是不会做，只是太懒，不愿意开始。", py: "Tā bú shì bú huì zuò, zhǐshì tài lǎn, bú yuànyì kāishǐ.", en: "It is not that he cannot do it; he is just too lazy and unwilling to start." },
      { cn: "我发现自己最近有点懒，所以每天给自己安排一个小目标。", py: "Wǒ fāxiàn zìjǐ zuìjìn yǒudiǎn lǎn, suǒyǐ měitiān gěi zìjǐ ānpái yí ge xiǎo mùbiāo.", en: "I noticed I have been a little lazy recently, so I set a small goal for myself every day." },
      { cn: "A：你为什么还没复习？B：我今天有点懒。", py: "A: Nǐ wèishénme hái méi fùxí? B: Wǒ jīntiān yǒudiǎn lǎn.", en: "A: Why have you not reviewed yet? B: I feel a little lazy today." },
      { cn: "A：别偷懒了。B：好，我现在就开始学习。", py: "A: Bié tōulǎn le. B: Hǎo, wǒ xiànzài jiù kāishǐ xuéxí.", en: "A: Stop slacking off. B: Okay, I will start studying now." },
      { cn: "虽然他以前很懒，但是现在每天都认真学习。", py: "Suīrán tā yǐqián hěn lǎn, dànshì xiànzài měitiān dōu rènzhēn xuéxí.", en: "Although he used to be lazy, now he studies seriously every day." },
      { cn: "为了改掉懒的习惯，他决定每天早起半个小时。", py: "Wèile gǎidiào lǎn de xíguàn, tā juédìng měitiān zǎoqǐ bàn ge xiǎoshí.", en: "To change his lazy habit, he decided to wake up half an hour earlier every day." },
      { cn: "别因为一时懒就放弃复习，考试前坚持最重要。", py: "Bié yīnwèi yìshí lǎn jiù fàngqì fùxí, kǎoshì qián jiānchí zuì zhòngyào.", en: "Do not give up reviewing just because you feel lazy for a moment; persistence before the exam matters most." },
    ],
    食物: [
      { cn: "我喜欢中国食物。", py: "Wǒ xǐhuan Zhōngguó shíwù.", en: "I like Chinese food." },
      { cn: "这个食物很好吃。", py: "Zhège shíwù hěn hǎochī.", en: "This food is tasty." },
      { cn: "这里有很多食物。", py: "Zhèlǐ yǒu hěn duō shíwù.", en: "There is a lot of food here." },
      { cn: "桌子上有很多新鲜的食物。", py: "Zhuōzi shàng yǒu hěn duō xīnxiān de shíwù.", en: "There is a lot of fresh food on the table." },
      { cn: "旅行的时候，我最喜欢尝当地的食物。", py: "Lǚxíng de shíhou, wǒ zuì xǐhuan cháng dāngdì de shíwù.", en: "When traveling, I like trying local food the most." },
      { cn: "这种食物看起来简单，但是味道很好。", py: "Zhè zhǒng shíwù kàn qǐlái jiǎndān, dànshì wèidào hěn hǎo.", en: "This kind of food looks simple, but it tastes good." },
    ],
    停: [
      { cn: "请停一下。", py: "Qǐng tíng yíxià.", en: "Please stop for a moment." },
      { cn: "车停在门口。", py: "Chē tíng zài ménkǒu.", en: "The car stopped at the entrance." },
      { cn: "我们在这里停。", py: "Wǒmen zài zhèlǐ tíng.", en: "We stop here." },
      { cn: "听到老师的话，大家都停了下来。", py: "Tīngdào lǎoshī de huà, dàjiā dōu tíng le xiàlái.", en: "After hearing the teacher, everyone stopped." },
      { cn: "地铁停了两分钟，然后继续开。", py: "Dìtiě tíng le liǎng fēnzhōng, ránhòu jìxù kāi.", en: "The subway stopped for two minutes and then kept going." },
      { cn: "请把车停在学校旁边。", py: "Qǐng bǎ chē tíng zài xuéxiào pángbiān.", en: "Please park the car beside the school." },
    ],
    停止: [
      { cn: "请停止说话。", py: "Qǐng tíngzhǐ shuōhuà.", en: "Please stop talking." },
      { cn: "雨停止了。", py: "Yǔ tíngzhǐ le.", en: "The rain stopped." },
      { cn: "他停止工作。", py: "Tā tíngzhǐ gōngzuò.", en: "He stops working." },
      { cn: "如果觉得累，可以先停止练习。", py: "Rúguǒ juéde lèi, kěyǐ xiān tíngzhǐ liànxí.", en: "If you feel tired, you can stop practicing first." },
      { cn: "会议结束以后，大家停止讨论。", py: "Huìyì jiéshù yǐhòu, dàjiā tíngzhǐ tǎolùn.", en: "After the meeting ended, everyone stopped discussing." },
      { cn: "他决定停止玩手机，开始认真复习。", py: "Tā juédìng tíngzhǐ wán shǒujī, kāishǐ rènzhēn fùxí.", en: "He decided to stop using his phone and start reviewing seriously." },
    ],
  };
  const examples = special[word.char] ? [...special[word.char]] : [];
  if (word.example && !examples.some((item) => item.cn === word.example)) {
    examples.unshift({ cn: word.example, py: "", en: word.exEn || "" });
  }
  const meaning = firstMeaning(word.meaning || "this word");
  if (word.tags?.includes("adjective")) {
    examples.push(
      { cn: `这个地方很${word.char}。`, py: "", en: `This place is very ${meaning}.` },
      { cn: `我觉得今天有点${word.char}。`, py: "", en: `I feel a little ${meaning} today.` },
      { cn: `虽然情况很${word.char}，但是我们可以慢慢解决。`, py: "", en: `Although the situation is very ${meaning}, we can solve it slowly.` },
    );
  } else if (word.tags?.includes("verb")) {
    examples.push(
      { cn: `我想${word.char}一下。`, py: "", en: `I want to ${meaning} for a moment.` },
      { cn: `他每天都练习怎么${word.char}。`, py: "", en: `He practices how to ${meaning} every day.` },
      { cn: `如果不明白，可以先问老师再${word.char}。`, py: "", en: `If you do not understand, you can ask the teacher first and then ${meaning}.` },
    );
  } else if (word.tags?.includes("noun")) {
    examples.push(
      { cn: `这里有很多${word.char}。`, py: "", en: `There are many ${meaning} here.` },
      { cn: `这个${word.char}对我很重要。`, py: "", en: `This ${meaning} is important to me.` },
      { cn: `A：你喜欢这个${word.char}吗？B：喜欢，很有意思。`, py: "", en: `A: Do you like this ${meaning}? B: Yes, it is interesting.` },
    );
  } else {
    examples.push(
      { cn: `这个句子里有“${word.char}”。`, py: "", en: `This sentence contains "${word.char}".` },
      { cn: `老师用“${word.char}”写了一个新句子。`, py: "", en: `The teacher wrote a new sentence with "${word.char}".` },
      { cn: `A：“${word.char}”是什么意思？B：我们一起看例句。`, py: "", en: `A: What does "${word.char}" mean? B: Let's look at examples together.` },
    );
  }
  return [
    ...examples,
  ];
}

function answerVocabulary(word, { detailed = false } = {}) {
  if (word.kind === "common") {
    const examples = word.examples.slice(0, detailed ? 3 : 1).map((example, index) => `${index + 1}. ${example.cn}\n${example.en}`).join("\n");
    const reply = `${word.term} = ${word.word}
Pinyin: ${word.pinyin}
Meaning: ${word.meaning}

Example:
${examples}`;
    return {
      reply,
      audioItems: [
        makeAudio(word.char || word.word, word.char || word.word.split(" / ")[0]),
        ...word.examples.slice(0, detailed ? 3 : 1).map((example, index) => makeAudio(`Example ${index + 1}`, example.cn)),
      ],
      lastTopic: { type: "vocab", word },
    };
  }

  const examples = exampleSentencesFor(word);
  if (!detailed) {
    const heading = word.lookupTerm ? `${capitalizeTerm(word.lookupTerm)} = ${word.char}` : `${word.char} = ${firstMeaning(word.meaning)}`;
    return {
      reply: `${heading}
Pinyin: ${word.pinyin}
Meaning: ${word.meaning}

Example:
${examples[0].cn} = ${examples[0].en}`,
      audioItems: [makeAudio(word.char, word.char), makeAudio("Example", examples[0].cn)],
      lastTopic: { type: "vocab", word },
    };
  }

  return {
    reply: `Chinese word: ${word.char}
Pinyin: ${word.pinyin}
English meaning: ${word.meaning}
HSK level: HSK ${word.difficulty}

Simple explanation:
${word.char} is commonly used as ${word.tags?.join(", ") || "an HSK word"}. Use it in short sentences first.

Example sentences:
${examples.map((example, index) => `${index + 1}. ${example.cn}\n   ${example.py}\n   ${example.en}`).join("\n")}

Practice:
Write one sentence with “${word.char}”, and I will correct it.`,
    audioItems: [makeAudio(word.char, word.char), ...examples.map((example, index) => makeAudio(`Example ${index + 1}`, example.cn))],
    lastTopic: { type: "vocab", word },
  };
}

const isChineseChar = (char = "") => /[\u3400-\u9fff]/.test(char);
const isChineseText = (text = "") => /[\u3400-\u9fff]/.test(text);
const sentenceAround = (text = "", start = 0) => {
  const left = Math.max(
    text.lastIndexOf("。", start - 1),
    text.lastIndexOf("！", start - 1),
    text.lastIndexOf("？", start - 1),
    text.lastIndexOf("\n", start - 1)
  );
  const rightCandidates = ["。", "！", "？", "\n"].map((mark) => text.indexOf(mark, start)).filter((index) => index >= 0);
  const right = rightCandidates.length ? Math.min(...rightCandidates) + 1 : text.length;
  return text.slice(left + 1, right).trim();
};
async function speakChinese(text, rate = 1) {
  if (!text) return;
  if (!USE_OPENAI_TTS) {
    showAudioNotice();
    playBrowserTts(text, { voice: "nova", speed: rate, key: `lookup-${text}-${rate}` });
    return;
  }
  try {
    await playOpenAiTts(text, { voice: "nova", speed: rate, cachePrefix: "lookup" });
  } catch (error) {
    console.error("[HanZi TTS frontend] lookup audio failed", error);
    showAudioNotice();
    playBrowserTts(text, { voice: "nova", speed: rate, key: `lookup-${text}-${rate}` });
  }
}
const lookupVocabulary = (term) => {
  const clean = term.replace(/[，。！？、；：,.!?;:"“”'‘’\s]/g, "");
  if (!clean) return null;
  const exact = allWords().find((word) => word.char === clean);
  if (exact) return exact;
  const partial = allWords()
    .filter((word) => clean.includes(word.char) || word.char.includes(clean))
    .sort((a, b) => b.char.length - a.char.length || a.difficulty - b.difficulty)[0];
  if (partial) return partial;
  return {
    id: `lookup-${clean}`,
    char: clean,
    pinyin: "",
    meaning: "Not in the local HSK 1-5 dictionary yet.",
    difficulty: "?",
    tags: ["unknown"],
    example: `${clean}。`,
    exEn: "Add this word to your custom vocabulary for review.",
  };
};
const popupPositionForRect = (rect, width = 260, height = 138) => {
  const gap = 8;
  const margin = 12;
  let left = rect.left;
  if (left + width > window.innerWidth - margin) left = rect.right - width;
  if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
  if (left < margin) left = margin;

  let top = rect.bottom + gap;
  if (top + height > window.innerHeight - margin) top = rect.top - height - gap;
  if (top < margin) top = margin;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - height - margin);

  return { left, top };
};
const smartSegmentChinese = (text = "") => {
  const dict = [...new Set([...allWords().map((word) => word.char), ...COMMON_SEGMENT_WORDS].filter(Boolean))].sort((a, b) => b.length - a.length);
  const maxLen = Math.max(1, ...dict.map((word) => word.length));
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (!isChineseChar(text[i])) {
      let j = i + 1;
      while (j < text.length && !isChineseChar(text[j])) j += 1;
      tokens.push({ text: text.slice(i, j), chinese: false, start: i, end: j });
      i = j;
      continue;
    }
    let match = "";
    const limit = Math.min(maxLen, text.length - i);
    for (let len = limit; len > 0; len -= 1) {
      const candidate = text.slice(i, i + len);
      if (dict.includes(candidate)) {
        match = candidate;
        break;
      }
    }
    const token = match || text[i];
    tokens.push({ text: token, chinese: true, start: i, end: i + token.length });
    i += token.length;
  }
  return tokens;
};

function WordLookupPopup({ lookup, onClose }) {
  if (!lookup) return null;
  const word = lookup.word;
  const pos = word?.partOfSpeech || word?.grammar || word?.tags?.find((tag) => !["cleaned", "verified"].includes(tag)) || word?.tags?.[0] || "word";
  const hskLevel = word?.hskLevel || word?.difficulty || "?";
  const popover = (
    <div className="hz-lookup-popover" style={{ left: lookup.left, top: lookup.top }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <button className="hz-lookup-close" title="Close" onClick={onClose}>×</button>
      <div className="hz-lookup-word">{word?.char || lookup.term}</div>
      <div className="hz-lookup-pinyin">{word?.pinyin || "unknown"}</div>
      <div className="hz-lookup-meaning">{word?.meaning || "unknown"}</div>
      <div className="hz-lookup-foot">
        <span>{pos}</span>
        <button className="hz-lookup-audio" title="Listen" onClick={() => speakChinese(word?.char || lookup.term)}>🔊</button>
      </div>
      <div className="hz-lookup-badge">HSK {hskLevel}</div>
    </div>
  );
  return createPortal(popover, document.body);
}

function InteractiveChineseText({ text = "", className = "", style = {}, sentenceHints = [] }) {
  const [active, setActive] = useState(null);
  const [popup, setPopup] = useState(null);
  const pressTimer = useRef(null);
  const tokens = useMemo(() => smartSegmentChinese(text), [text]);
  const openWord = (event, token) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const position = popupPositionForRect(rect);
    setPopup({
      type: "word",
      term: token.text,
      word: lookupVocabulary(token.text),
      ...position,
    });
  };
  const openSentence = (event, token) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const sentence = sentenceAround(text, token.start);
    const firstWord = smartSegmentChinese(sentence).find((item) => item.chinese) || token;
    const position = popupPositionForRect(rect);
    setPopup({
      type: "word",
      term: firstWord.text,
      word: lookupVocabulary(firstWord.text),
      ...position,
    });
  };
  const longPress = (event, token) => {
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => openWord(event, token), 520);
  };

  useEffect(() => {
    if (!popup) return undefined;
    const close = () => setPopup(null);
    const onKeyDown = (event) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [popup]);

  if (!isChineseText(text)) return <span className={className} style={style}>{text}</span>;

  return (
    <span className={`hz-smart-text ${className}`} style={style} onClick={(event) => event.stopPropagation()}>
      {tokens.map((token, index) => token.chinese ? (
        <span
          key={`${token.text}-${token.start}-${index}`}
          className={`hz-smart-word ${active?.start === token.start ? "active" : ""}`}
          title="Click to highlight, double click to inspect, triple click for sentence"
          onClick={(event) => {
            if (event.detail === 1) {
              setActive(token);
              openWord(event, token);
            }
            if (event.detail >= 3) openSentence(event, token);
          }}
          onDoubleClick={(event) => openWord(event, token)}
          onTouchStart={(event) => longPress(event, token)}
          onTouchEnd={() => clearTimeout(pressTimer.current)}
        >
          {token.text}
        </span>
      ) : <span key={`${token.start}-${index}`}>{token.text}</span>)}
      <WordLookupPopup lookup={popup} onClose={() => setPopup(null)} />
    </span>
  );
}

function normalizeExampleText(text = "") {
  return text.replace(/\s+/g, "").replace(/[，。！？、；：,.!?;:"“”'’‘]/g, "");
}

function pickFreshExamples(topicKey, examples, state, count = 3) {
  const usedExamples = { ...(state?.usedExamples || {}) };
  const usedForTopic = usedExamples[topicKey] || [];
  const usedSet = new Set(usedForTopic.map(normalizeExampleText));
  const fresh = examples.filter((example) => !usedSet.has(normalizeExampleText(example.cn))).slice(0, count);
  usedExamples[topicKey] = [...usedForTopic, ...fresh.map((example) => example.cn)];
  return { examples: fresh, usedExamples };
}

function exampleCountFromText(text) {
  const match = normalizeTutorText(text).match(/\b(?:give me\s*)?([1-9])\s*(?:more\s*)?(?:examples?|sentences?)\b/);
  return Math.min(8, Math.max(1, Number(match?.[1] || 3)));
}

function grammarExamplePool(lesson) {
  const title = lesson?.title || "";
  if (title.includes("了")) {
    return [
      { cn: "我吃了饭。", en: "I ate." },
      { cn: "他买了一本书。", en: "He bought a book." },
      { cn: "我们昨天看了电影。", en: "We watched a movie yesterday." },
      { cn: "天气冷了。", en: "The weather has become cold." },
      { cn: "A：你写完了吗？B：我写完了。", en: "A: Did you finish writing? B: I finished." },
      { cn: "他学了两年中文，所以能看简单的文章。", en: "He studied Chinese for two years, so he can read simple articles." },
    ];
  }
  if (title.includes("把")) {
    return [
      { cn: "我把书放在桌子上。", en: "I put the book on the table." },
      { cn: "请把门关上。", en: "Please close the door." },
      { cn: "他把作业做完了。", en: "He finished the homework." },
      { cn: "我把这句话翻译成中文。", en: "I translated this sentence into Chinese." },
      { cn: "A：你把手机放哪儿了？B：我把手机放包里了。", en: "A: Where did you put your phone? B: I put it in my bag." },
      { cn: "考试以前，我把重要的生词都复习了一遍。", en: "Before the exam, I reviewed all the important new words once." },
    ];
  }
  if (title.includes("因为")) {
    return [
      { cn: "因为下雨，我不去公园。", en: "Because it is raining, I will not go to the park." },
      { cn: "因为我很累，所以想休息。", en: "Because I am tired, I want to rest." },
      { cn: "他迟到了，因为路上车很多。", en: "He was late because there was a lot of traffic." },
      { cn: "因为中文很有意思，所以我每天学习。", en: "Because Chinese is interesting, I study every day." },
      { cn: "A：你为什么学习中文？B：因为我想去中国旅行。", en: "A: Why do you study Chinese? B: Because I want to travel to China." },
      { cn: "因为这篇文章有很多新词，所以我读得比较慢。", en: "Because this article has many new words, I read it rather slowly." },
    ];
  }
  if (title.includes("虽然")) {
    return [
      { cn: "虽然今天很忙，但是我还要学习中文。", en: "Although I am busy today, I still need to study Chinese." },
      { cn: "虽然这个字很难，但是我记住了。", en: "Although this character is difficult, I remembered it." },
      { cn: "虽然他不太会说中文，但是他很努力。", en: "Although he cannot speak Chinese very well, he works hard." },
      { cn: "虽然天气不好，但是我们还是去了学校。", en: "Although the weather was bad, we still went to school." },
      { cn: "A：这个语法难吗？B：虽然有点难，但是例句很清楚。", en: "A: Is this grammar hard? B: Although it is a little hard, the examples are clear." },
      { cn: "虽然我只学了一年中文，但是已经能看懂简单的故事。", en: "Although I have only studied Chinese for one year, I can already understand simple stories." },
    ];
  }
  return [
    { cn: lesson.examples?.[0]?.cn || "我学习中文。", en: lesson.examples?.[0]?.en || "I study Chinese." },
    { cn: "老师用这个语法写了一个简单的句子。", en: "The teacher wrote a simple sentence with this grammar." },
    { cn: "如果你多看例句，这个语法会更容易。", en: "If you read more examples, this grammar will become easier." },
  ];
}

function moreExamplesForTopic(topic, state = createTutorState(), count = 3) {
  if (!topic) return null;
  if (topic.type === "vocab") {
    const word = topic.word;
    const topicKey = word.char || word.word;
    const examples = word.kind === "common"
      ? [
        ...(word.examples || []),
        ...exampleSentencesFor({ ...word, tags: word.tags || [], meaning: word.meaning || firstMeaning(word.meaning || "") })
          .map((item) => ({ cn: item.cn, en: item.en })),
      ].filter((example, index, list) => list.findIndex((item) => item.cn === example.cn) === index)
      : exampleSentencesFor(word).map((item) => ({ cn: item.cn, en: item.en }));
    const picked = pickFreshExamples(topicKey, examples, state, count);
    if (!picked.examples.length) {
      return {
        reply: `I already showed all fresh local examples I have for ${topicKey} in this chat. Ask for a harder sentence, a dialogue, or add more examples to the verified content database.`,
        audioItems: [],
        lastTopic: topic,
        generatedExamples: [],
        usedExamples: picked.usedExamples,
      };
    }
    return {
      reply: picked.examples.map((example, index) => `${index + 1}. ${example.cn}\n${example.en}`).join("\n"),
      audioItems: picked.examples.map((example, index) => makeAudio(`Example ${index + 1}`, example.cn)),
      lastTopic: topic,
      generatedExamples: picked.examples.map((example) => example.cn),
      usedExamples: picked.usedExamples,
    };
  }
  if (topic.type === "grammar" && topic.lesson) {
    const topicKey = `grammar:${topic.lesson.title}`;
    const sourceExamples = [
      ...topic.lesson.examples.map((example) => ({ cn: example.cn, en: example.en })),
      ...grammarExamplePool(topic.lesson),
    ].filter((example, index, list) => list.findIndex((item) => item.cn === example.cn) === index);
    const picked = pickFreshExamples(topicKey, sourceExamples, state, count);
    const examples = picked.examples;
    if (!examples.length) {
      return {
        reply: `I already used the available local examples for ${topic.lesson.title} in this chat. Ask me for a new generated dialogue or a harder HSK-style example.`,
        audioItems: [],
        lastTopic: topic,
        generatedExamples: [],
        usedExamples: picked.usedExamples,
      };
    }
    return {
      reply: examples.map((example, index) => `${index + 1}. ${example.cn}\n${example.en}`).join("\n"),
      audioItems: examples.map((example, index) => makeAudio(`Example ${index + 1}`, example.cn)),
      lastTopic: topic,
      generatedExamples: examples.map((example) => example.cn),
      usedExamples: picked.usedExamples,
    };
  }
  return null;
}

function answerGrammar(lesson, text) {
  const examples = lesson.examples.slice(0, 2);
  const rendered = examples.map((example, index) => `${index + 1}. ${example.cn}\n   ${example.py}\n   ${example.en}`).join("\n");
  const chineseMode = hasChinese(text) && !/[a-z]{3,}/i.test(text);
  return {
    reply: `${chineseMode ? "这个语法点这样用：\n" : ""}${lesson.title}

Meaning/use:
${lesson.rule}

Formula:
${formulaForLesson(lesson.title)}

Examples:
${rendered}

Common mistake:
${lesson.mistakes[0] || "Do not translate the English pattern word-for-word."}`,
    audioItems: examples.map((example, index) => makeAudio(`Example ${index + 1}`, example.cn)),
    lastTopic: { type: "grammar", lesson },
  };
}

function answerDeParticles() {
  return {
    reply: `的、地、得

- 的 modifies nouns: 我的书 = my book
- 地 modifies verbs: 慢慢地说 = speak slowly
- 得 describes the result/degree after a verb: 说得很好 = speak very well

Formula:
- adjective/noun phrase + 的 + noun
- adverbial phrase + 地 + verb
- verb + 得 + degree/evaluation

Examples:
1. 这是我的书。Zhè shì wǒ de shū. This is my book.
2. 她认真地学习。Tā rènzhēn de xuéxí. She studies seriously.
3. 他说中文说得很好。Tā shuō Zhōngwén shuō de hěn hǎo. He speaks Chinese very well.

Practice:
Choose 的、地、得: 他跑___很快。`,
    audioItems: [
      makeAudio("我的书", "我的书"),
      makeAudio("认真地学习", "认真地学习"),
      makeAudio("说得很好", "说得很好"),
    ],
    lastTopic: { type: "grammar", lesson: null },
  };
}

function correctSentence(text, vocab) {
  const sentence = chineseOnly(text).trim();
  if (sentence.includes("我昨天去学校了很开心")) {
    const better = "我昨天去了学校，觉得很开心。";
    return {
      reply: `Correct sentence:
我昨天去学校了，很开心。

Why:
The sentence needs a pause after the first completed action. To sound more natural, add 觉得 to show the feeling.

Better natural version:
${better}`,
      audioItems: [makeAudio("Better", better)],
      lastTopic: { type: "sentence", sentence: better },
    };
  }
  if (sentence.includes("我很喜欢学习中文因为有意思")) {
    const better = "我很喜欢学习中文，因为它很有意思。";
    return {
      reply: `Correct:
${better}

Why:
Use a comma before 因为, and add 它 to refer to 中文.`,
      audioItems: [makeAudio("Correct sentence", better)],
      lastTopic: { type: "sentence", sentence: better },
    };
  }
  const fixes = [
    { test: /是.{0,3}(漂亮|好|忙|高兴|冷|热|大|小|难|容易)/, from: "是 + adjective", to: "Use 很 before ordinary adjectives.", example: "她很漂亮。" },
    { test: /吗.*[。！？?]?$|^吗/, from: "吗 placement", to: "Put 吗 at the end of a statement.", example: "你是学生吗？" },
    { test: /昨天.*不(去|吃|买|看|来|做)/, from: "past negation", to: "Use 没/没有 for completed past actions.", example: "我昨天没去学校。" },
    { test: /[一二三四五六七八九十两]\s*[\u3400-\u9fff]{1,3}/, from: "measure words", to: "Many nouns need a measure word after numbers.", example: "三个朋友 / 一本书 / 一杯茶" },
  ];
  const found = fixes.find((fix) => fix.test.test(sentence));
  const matchedWords = findVocabulary(sentence, vocab).slice(0, 6);
  if (!found) {
    return {
      reply: `Sentence check:
${sentence}

I do not see a major HSK 1-4 grammar problem. It sounds understandable.

Useful notes:
${matchedWords.length ? matchedWords.map((word) => `- ${word.char} (${word.pinyin}) = ${word.meaning}`).join("\n") : "- Try sending a longer sentence if you want a deeper correction."}

If you want, write your intended English meaning and I can make the sentence more natural.`,
      audioItems: sentence ? [makeAudio("Sentence", sentence)] : [],
      lastTopic: { type: "sentence", sentence },
    };
  }

  return {
    reply: `Sentence correction:
Original: ${sentence}

Issue: ${found.from}
Explanation: ${found.to}
Better example: ${found.example}

Why:
Chinese word order and particles are strict at HSK 1-4 level. Keep the pattern simple first, then add time/place/details.

Practice:
Rewrite your sentence using this pattern.`,
    audioItems: [makeAudio("Original", sentence), makeAudio("Better example", found.example)],
    lastTopic: { type: "sentence", sentence },
  };
}

function generateReading(text, vocab) {
  const level = extractHskLevel(text);
  const words = sampleItems(wordsForLevel(level), 8);
  const [w1, w2] = words;
  const title = `HSK ${level} Reading: 学习中文`;
  const body = level <= 2
    ? `今天我学习中文。我觉得“${w1.char}”很重要。我的朋友也喜欢学习。我们一起看书、听课，还用“${w2.char}”造句。虽然中文不容易，但是很有意思。`
    : `最近我在准备HSK ${level}考试。为了提高中文水平，我每天复习“${w1.char}”和“${w2.char}”，也练习阅读。遇到不懂的句子时，我会先找关键词，再分析语法结构。这样学习虽然需要时间，但是效果很好。`;
  const pinyin = level <= 2
    ? `Jīntiān wǒ xuéxí Zhōngwén. Wǒ juéde “${w1.pinyin}” hěn zhòngyào. Wǒ de péngyou yě xǐhuan xuéxí. Wǒmen yìqǐ kànshū, tīngkè, hái yòng “${w2.pinyin}” zàojù. Suīrán Zhōngwén bù róngyì, dànshì hěn yǒu yìsi.`
    : `Zuìjìn wǒ zài zhǔnbèi HSK ${level} kǎoshì. Wèile tígāo Zhōngwén shuǐpíng, wǒ měitiān fùxí “${w1.pinyin}” hé “${w2.pinyin}”, yě liànxí yuèdú. Yùdào bù dǒng de jùzi shí, wǒ huì xiān zhǎo guānjiàncí, zài fēnxī yǔfǎ jiégòu. Zhèyàng xuéxí suīrán xūyào shíjiān, dànshì xiàoguǒ hěn hǎo.`;
  const translation = level <= 2
    ? `Today I study Chinese. I think “${w1.char}” is important. My friend also likes studying. We read, listen to lessons, and use “${w2.char}” to make sentences. Although Chinese is not easy, it is very interesting.`
    : `Recently I am preparing for the HSK ${level} exam. To improve my Chinese level, I review “${w1.char}” and “${w2.char}” every day and also practice reading. When I meet a sentence I do not understand, I first find the key words and then analyze the grammar structure. This way of studying takes time, but the result is good.`;
  const wantsTranslation = /translate|translation|pinyin|meaning|翻译|拼音/i.test(text);
  return {
    reply: `${title}

Chinese text:
${body}

Comprehension questions:
1. 这个人今天学习什么？
2. 他觉得什么很重要？
3. 中文容易吗？${wantsTranslation ? `

Pinyin:
${pinyin}

English translation:
${translation}

Vocabulary:
${words.slice(0, 5).map((word) => `- ${word.char} (${word.pinyin}) = ${word.meaning}`).join("\n")}` : ""}

Answer the questions, and I will correct you.`,
    audioItems: [
      makeAudio("Full reading", body),
      ...words.slice(0, 6).map((word) => makeAudio(word.char, word.char)),
    ],
    lastTopic: { type: "reading", text: body, pinyin, translation, words },
  };
}

function generateListening(text) {
  const level = extractHskLevel(text);
  const words = sampleItems(wordsForLevel(level), 5);
  const body = level <= 2
    ? `今天我去学校学习中文。老师说，学习要慢慢来。下课以后，我和朋友一起复习新词。`
    : `为了准备HSK ${level}，我每天听一段中文短文。第一遍我只听大意，第二遍我写下关键词，最后再看文本检查。`;
  return {
    reply: `Listening practice HSK ${level}

First, press the speaker button and listen without reading too much.

Chinese text:
${body}

Questions:
1. 这个人去哪儿？
2. 他和谁一起复习？
3. What is the main idea?

Reply with your answers, and I will check them.`,
    audioItems: [
      makeAudio("Play listening", body),
      makeAudio("Audio", body),
      ...words.slice(0, 3).map((word) => makeAudio(word.char, word.char)),
    ],
    lastTopic: { type: "listening", text: body },
  };
}

function generateExercises(text) {
  const level = extractHskLevel(text);
  const words = sampleItems(wordsForLevel(level), 6);
  const [a, b, c, d, e, f] = words;
  const questions = [
    { type: "blank", prompt: "我今天____中文。", answer: "学习", explain: "The natural verb is 学习: 我今天学习中文。" },
    { type: "choice", prompt: `“${d.char}” means:\nA. ${a.meaning}\nB. ${d.meaning}\nC. ${e.meaning}`, answer: "B", explain: `${d.char} (${d.pinyin}) = ${d.meaning}` },
    { type: "translation", prompt: "Translate into Chinese: I study Chinese every day.", answer: "我每天学习中文", explain: "Time 每天 usually comes before the verb." },
    { type: "ordering", prompt: "Put in order: 中文 / 我 / 学习 / 今天", answer: "我今天学习中文", explain: "Chinese order: subject + time + verb + object." },
    { type: "correction", prompt: "Fix this sentence: 我昨天不去学校。", answer: "我昨天没去学校", explain: "For a completed past action, use 没, not 不." },
    { type: "sentence", prompt: `Make one sentence with “${f.char}”.`, answer: f.char, explain: `Your sentence should use ${f.char} naturally.` },
  ];
  return {
    reply: `HSK ${level} exercise set:

1. Fill in the blank:
${questions[0].prompt}

2. Multiple choice:
${questions[1].prompt}

3. Translation:
${questions[2].prompt}

4. Sentence ordering:
${questions[3].prompt}

5. Correction:
${questions[4].prompt}

6. Vocabulary sentence:
${questions[5].prompt}

Send your answers like:
1. 学习
2. B
3. ...`,
    audioItems: [
      makeAudio("Exercise 1", "我今天学习中文。"),
      makeAudio(d.char, d.char),
      makeAudio("Exercise 4", "我今天学习中文。"),
      makeAudio(f.char, f.char),
    ],
    exercise: { level, questions },
    lastTopic: { type: "exercise", level },
  };
}

function makeQuiz(level) {
  const questions = sampleItems(wordsForLevel(level), 6).map((word) => ({
    word,
    prompt: `HSK ${level} quiz\nWhat does “${word.char}” (${word.pinyin}) mean?`,
    answer: word.meaning,
  }));
  return { level, index: 0, score: 0, questions };
}

function askQuizQuestion(quiz) {
  const current = quiz.questions[quiz.index];
  return {
    reply: `${current.prompt}

Question ${quiz.index + 1}/${quiz.questions.length}.`,
    audioItems: [makeAudio(current.word.char, current.word.char)],
  };
}

function gradeQuizAnswer(answer, quiz) {
  const current = quiz.questions[quiz.index];
  const expected = current.answer.toLowerCase();
  const clean = answer.toLowerCase();
  const correct = expected.split(/[;\/,()]+/).some((part) => part.trim().length > 2 && clean.includes(part.trim()));
  const next = { ...quiz, index: quiz.index + 1, score: quiz.score + (correct ? 1 : 0) };
  const activity = {
    type: "ai_practice",
    payload: {
      correct,
      level: quiz.level,
      questionId: `ai-quiz-${quiz.level}-${quiz.index}-${current.word.char}`,
      source: "AI Tutor quiz",
      quizComplete: next.index >= next.questions.length,
      score: next.score,
      total: next.questions.length,
    },
  };
  const feedback = `${correct ? "Correct." : "Not quite."}

${current.word.char} (${current.word.pinyin}) = ${current.word.meaning}
Example: ${current.word.example}`;
  if (next.index >= next.questions.length) {
    return {
      quiz: null,
      activity,
      reply: `${feedback}

Quiz finished. Score: ${next.score}/${next.questions.length}.
Ask for another quiz when you are ready.`,
    };
  }
  const nextQuestion = askQuizQuestion(next);
  return { quiz: next, activity, reply: `${feedback}\n\nNext:\n${nextQuestion.reply}`, audioItems: [makeAudio(current.word.char, current.word.char), ...nextQuestion.audioItems] };
}

function gradeExerciseAnswer(answer, exercise) {
  const clean = answer.toLowerCase();
  const results = exercise.questions.map((question, index) => {
    const expected = question.answer.toLowerCase();
    const correct = question.type === "sentence"
      ? hasChinese(answer) && answer.includes(question.answer)
      : clean.includes(expected) || clean.includes(`${index + 1}. ${expected}`) || clean.includes(`${index + 1}${expected}`);
    return { questionId: `ai-exercise-${exercise.level}-${index}-${normalizeAnswerText(question.prompt).slice(0, 24)}`, correct, explain: question.explain };
  });
  return {
    exercise: null,
    activity: { type: "ai_practice", payload: { level: exercise.level, source: "AI Tutor exercise", answers: results } },
    reply: `Exercise feedback:
${results.map((item, index) => `${index + 1}. ${item.correct ? "Correct" : "Check again"} - ${item.explain}`).join("\n")}

Want another set? Ask: Give me HSK 2 exercises.`,
    audioItems: exercise.questions
      .filter((question) => hasChinese(question.prompt))
      .slice(0, 4)
      .map((question, index) => makeAudio(`Exercise ${index + 1}`, chineseOnly(question.prompt).replace(/[，。！？、；：]/g, ""))),
  };
}

function continueTopic(text, topic, state = createTutorState()) {
  if (!topic) return null;
  const lower = normalizeTutorText(text);
  const requestedExampleCount = exampleCountFromText(text);
  if (/more examples|examples?|example|sentences?|sentence with it|with it|more|give me \d+ more|continue|例句|造句/i.test(lower)) return moreExamplesForTopic(topic, state, requestedExampleCount);
  if (/didn't understand|do not understand|don't understand|explain again|easier|simple|simpler/i.test(lower)) {
    if (topic.type === "vocab") {
      const word = topic.word;
      return {
        reply: `In simple words:
${word.char} (${word.pinyin}) means "${firstMeaning(word.meaning)}".

Example:
${exampleSentencesFor(word)[0].cn} = ${exampleSentencesFor(word)[0].en}`,
        audioItems: [makeAudio(word.char, word.char), makeAudio("Example", exampleSentencesFor(word)[0].cn)],
        lastTopic: topic,
      };
    }
    if (topic.type === "grammar" && topic.lesson) {
      return {
        reply: `${topic.lesson.title}

Simple idea:
${topic.lesson.rule}

Pattern:
${formulaForLesson(topic.lesson.title)}

Example:
${topic.lesson.examples[0]?.cn}
${topic.lesson.examples[0]?.en}`,
        audioItems: topic.lesson.examples[0] ? [makeAudio("Example", topic.lesson.examples[0].cn)] : [],
        lastTopic: topic,
      };
    }
  }
  if (/more details|more detail|explain more|explain it|explain|why|详细|为什么/i.test(lower)) {
    if (topic.type === "vocab") return answerVocabulary(topic.word, { detailed: true });
    if (topic.type === "grammar" && topic.lesson) return answerGrammar(topic.lesson, "explain");
    if (topic.type === "sentence") {
      return {
        reply: "The key idea is word order. In Chinese, time words usually come before the verb: Subject + Time + Verb + Object.",
        audioItems: topic.sentence ? [makeAudio("Sentence", topic.sentence)] : [],
        lastTopic: topic,
      };
    }
  }
  if (/translate it|translate paragraph|translate|翻译/i.test(lower) && topic.type === "reading") {
    return {
      reply: topic.translation || "I do not have a saved translation for that reading.",
      audioItems: [makeAudio("Reading", topic.text)],
      lastTopic: topic,
    };
  }
  if (/again|another|another one|continue|再来|继续|另一个/i.test(lower)) {
    if (topic.type === "reading") return generateReading(`HSK ${extractHskLevel(text)} reading`, allWords());
    if (topic.type === "listening") return generateListening(`HSK ${extractHskLevel(text)} listening`);
    if (topic.type === "vocab") return moreExamplesForTopic(topic, state, requestedExampleCount);
    if (topic.type === "exercise") return generateExercises(`HSK ${topic.level || extractHskLevel(text)} exercises`);
  }
  if (/make it hard|make hard|make it harder|make harder|harder|更难/i.test(lower)) {
    const level = Math.min(4, (topic.level || 2) + 1);
    if (topic.type === "reading") return generateReading(`HSK ${level} reading`, allWords());
    if (topic.type === "listening") return generateListening(`HSK ${level} listening`);
    return generateExercises(`HSK ${level} exercises`);
  }
  return null;
}

function isGreeting(text) {
  return /^(hi|hello|hey|yo|what'?s up|你好|嗨|哈喽|hello there)[!.。！?\s]*$/i.test(text.trim());
}

function isChineseLearningQuestion(text) {
  const lower = normalizeTutorText(text);
  return hasChinese(text) || /chinese|mandarin|hsk|pinyin|word|vocab|vocabulary|grammar|sentence|translate|translation|reading|listening|listen|exercise|quiz|practice|correct|speak|pronunciation|tone|tones|中文|汉语|普通话|拼音|词|词语|语法|句子|翻译|阅读|听力|练习|测验|纠正|发音|声调/i.test(text) || /\b(le|ba|bei|de|zai|pinyin|tones?|hsk)\b/.test(lower);
}

function findBookLesson(text) {
  const level = extractHskLevel(text);
  const lessons = level ? bookLessonsForLevel(level) : LEVELS.flatMap((item) => bookLessonsForLevel(item));
  const lessonNumber = Number(text.match(/lesson\s*(\d+)|第\s*(\d+)\s*课/i)?.[1] || text.match(/lesson\s*(\d+)|第\s*(\d+)\s*课/i)?.[2]);
  if (lessonNumber) {
    const byNumber = lessons.find((lesson) => lesson.lesson === lessonNumber);
    if (byNumber) return byNumber;
  }
  return lessons.find((lesson) =>
    text.includes(lesson.titleCn) ||
    text.toLowerCase().includes((lesson.titleEn || "").toLowerCase()) ||
    (lesson.grammar || []).some((point) => point.length > 3 && text.toLowerCase().includes(point.toLowerCase()))
  ) || null;
}

function answerBookLesson(lesson) {
  return {
    reply: `${lesson.bookTitle} · Lesson ${lesson.lesson}

Topic:
${lesson.titleCn}
${lesson.titlePinyin || ""}
${lesson.titleEn}

Book grammar focus:
${lesson.grammar?.length ? lesson.grammar.map((item, index) => `${index + 1}. ${item}`).join("\n") : "The PDF text layer did not expose the grammar notes cleanly. I can still help with vocabulary and practice for this lesson topic."}

Source note:
This is based on the local HSK Standard Course source database. Full copyrighted textbook dialogues/readings are not copied verbatim in the app.`,
    audioItems: lesson.titleCn ? [makeAudio("Lesson title", lesson.titleCn)] : [],
    lastTopic: { type: "bookLesson", lesson },
  };
}

function inferAudioItemsFromReply(reply) {
  const matches = reply.match(/[\u3400-\u9fff][\u3400-\u9fff，。！？、；：]{0,70}/g) || [];
  const seen = new Set();
  return matches
    .map((text) => text.replace(/[，。！？、；：]+$/g, "").trim())
    .filter((text) => text.length && !seen.has(text) && seen.add(text))
    .slice(0, 5)
    .map((text, index) => makeAudio(index === 0 ? "Audio" : `Audio ${index + 1}`, text));
}

function buildVerifiedTutorContext(message, vocab, state) {
  const words = [];
  const addWord = (word) => {
    if (!word?.char || words.some((item) => item.char === word.char)) return;
    words.push({
      word: word.char,
      pinyin: word.pinyin,
      meaning: word.meaning,
      hsk: word.difficulty,
      example: word.example,
      exampleMeaning: word.exEn,
      source: word.verified ? "verified local content database" : "cleaned HSK vocabulary database",
    });
  };

  const englishMatch = findEnglishVocabulary(message, vocab);
  if (englishMatch) addWord(englishMatch);
  findVocabulary(message, vocab).forEach(addWord);
  if (state?.lastWord) addWord(state.lastWord);
  if (state?.currentTopic?.type === "vocab") addWord(state.currentTopic.word);

  const grammar = findGrammar(message) || state?.lastGrammar || (state?.currentTopic?.type === "grammar" ? state.currentTopic.lesson : null);
  const grammarItems = grammar ? [{
    title: grammar.title,
    level: grammar.level,
    rule: grammar.rule,
    formula: formulaForLesson(grammar.title),
    examples: (grammar.examples || []).slice(0, 2).map((example) => ({
      chinese: example.cn,
      pinyin: example.py,
      english: example.en,
    })),
    mistakes: grammar.mistakes || [],
  }] : [];

  const bookLesson = /standard course|book|lesson|第\s*\d+\s*课|课文|source|教材/i.test(message)
    ? findBookLesson(message)
    : null;

  return {
    scope: "Chinese learning only, HSK 1-4 first",
    vocabulary: words.slice(0, 8),
    grammar: grammarItems,
    bookLesson: bookLesson ? {
      hsk: bookLesson.level,
      book: bookLesson.bookTitle,
      lesson: bookLesson.lesson,
      titleCn: bookLesson.titleCn,
      titleEn: bookLesson.titleEn,
      grammar: bookLesson.grammar || [],
    } : null,
  };
}

async function callTutorModel({ message, history, state, verifiedContext, language }) {
  const response = await fetch("/api/tutor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      conversationHistory: history.slice(-20),
      activeLearningState: state,
      verifiedHskContext: verifiedContext,
      language,
      system: `You are HanZi Tutor, a concise ChatGPT-style Chinese teacher for HSK 1-4.
Answer only Chinese-learning questions. Use verifiedHskContext first for vocabulary and grammar.
Keep simple questions short. Use conversationHistory and activeLearningState for follow-ups like "more", "it", "again", and "make it harder".
When generating examples, do not repeat sentences in activeLearningState.usedExamples. Return new Chinese examples in generatedExamples when possible.
If unsure about a vocabulary item, say "Let me check the correct Chinese meaning." before answering carefully.`,
    }),
  });
  if (!response.ok) throw new Error(`Tutor API failed with ${response.status}`);
  const data = await response.json();
  const reply = data.reply || data.content || data.text || data.message || data.choices?.[0]?.message?.content;
  if (!reply) return null;
  return {
    reply,
    audioItems: Array.isArray(data.audioItems) ? data.audioItems : inferAudioItemsFromReply(reply),
    quiz: data.quiz,
    exercise: data.exercise,
    lastTopic: data.lastTopic || null,
    activity: data.activity || null,
    generatedExamples: data.generatedExamples || [],
  };
}

function examplesFromResult(result = {}) {
  if (Array.isArray(result.generatedExamples) && result.generatedExamples.length) {
    return result.generatedExamples.filter(Boolean);
  }
  return (result.audioItems || [])
    .filter((item) => /^Example/i.test(item.label || ""))
    .map((item) => item.text)
    .filter(Boolean);
}

function updateTutorState(previous, result) {
  const next = { ...createTutorState(), ...previous };
  const hasQuiz = Object.prototype.hasOwnProperty.call(result, "quiz");
  const hasExercise = Object.prototype.hasOwnProperty.call(result, "exercise");
  if (hasQuiz) next.quizMode = result.quiz || null;
  if (hasExercise) next.lastExercise = result.exercise || null;
  if (result.lastTopic) next.currentTopic = result.lastTopic;

  const topic = result.lastTopic || next.currentTopic;
  if (topic?.type === "vocab") next.lastWord = topic.word;
  if (topic?.type === "grammar") next.lastGrammar = topic.lesson || topic;
  if (topic?.type === "sentence" || topic?.type === "translation") next.lastSentence = topic.sentence || topic.text || null;
  if (topic?.type === "reading") next.lastReading = topic;
  if (topic?.type === "listening") next.lastListening = topic;
  if (topic?.type === "exercise") next.lastExercise = result.exercise || next.lastExercise || topic;
  if (topic?.type === "quiz" && result.quiz) next.quizMode = result.quiz;
  next.usedExamples = result.usedExamples || { ...(next.usedExamples || {}) };
  const generatedExamples = examplesFromResult(result);
  const exampleKey = topic?.type === "vocab"
    ? (topic.word?.char || topic.word?.word)
    : topic?.type === "grammar" && topic.lesson
      ? `grammar:${topic.lesson.title}`
      : null;
  if (exampleKey && generatedExamples.length) {
    const usedExamples = { ...next.usedExamples };
    const previousExamples = usedExamples[exampleKey] || [];
    const previousSet = new Set(previousExamples.map(normalizeExampleText));
    const missing = generatedExamples.filter((example) => !previousSet.has(normalizeExampleText(example)));
    usedExamples[exampleKey] = [...previousExamples, ...missing];
    next.usedExamples = usedExamples;
    next.lastExamples = generatedExamples;
  } else if (generatedExamples.length) {
    next.lastExamples = generatedExamples;
  }
  return next;
}

function Tutor({ onActivity, language = "English", settings = createDefaultSettings() }) {
  const [messages, setMessages] = useState(() => loadTutorConversation());
  const [conversationHistory, setConversationHistory] = useState(() => compactTutorHistory(loadTutorConversation()));
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tutorState, setTutorState] = useState(() => ({ ...createTutorState(), ...readStorage(TUTOR_STATE_KEY, {}) }));
  const bottomRef = useRef(null);
  const vocab = useMemo(() => allWords(), []);
  const tr = (key) => uiText(language, key);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, loading]);
  useEffect(() => writeStorage(TUTOR_CONVERSATION_KEY, messages), [messages]);
  useEffect(() => writeStorage(TUTOR_STATE_KEY, tutorState), [tutorState]);

  const speak = useChineseSpeech(settings);

  const replyFor = (text, activeQuiz, activeExercise, previousTopic, historyForModel, activeState = createTutorState()) => {
    const recentHistory = historyForModel.slice(-20);
    const lower = normalizeTutorText(text);
    if (isGreeting(text)) {
      return {
        reply: "Hey! 👋 I'm HanZi Tutor. I can help you with Chinese vocabulary, grammar, pronunciation, reading, listening, exercises, and HSK preparation. What would you like to learn today?",
        audioItems: [],
      };
    }
    if (activeQuiz) return gradeQuizAnswer(text, activeQuiz);
    if (activeExercise) return gradeExerciseAnswer(text, activeExercise);
    const followUp = continueTopic(text, previousTopic, activeState);
    if (followUp) return followUp;

    if (/^zai\b|^zài\b/i.test(lower) && !text.includes("在") && !text.includes("再")) {
      return {
        reply: "Do you mean 在 (zài = at/in; doing something) or 再 (zài = again/then)?",
        audioItems: [makeAudio("在", "在"), makeAudio("再", "再")],
        lastTopic: { type: "grammar", lesson: null, point: "在 vs 再" },
      };
    }
    if (/(difference|区别).*(zai|在|再)|(zai|在|再).*(difference|区别)/i.test(lower) && (text.includes("在") || text.includes("再") || lower.includes("zai"))) {
      return answerZaiDifference();
    }

    const romanizedPhrase = findRomanizedPhrase(text);
    if (romanizedPhrase && /(mean|meaning|what|translate|chinese|pinyin)/i.test(lower)) return answerRomanizedPhrase(romanizedPhrase);

    const englishMatch = findEnglishVocabulary(text, vocab);
    if (englishMatch && !/python|javascript|react|node|npm|weather|movie|stock|crypto/i.test(lower)) {
      return { quiz: null, exercise: null, ...answerVocabulary(englishMatch, { detailed: /explain|detail|详细/i.test(text) }) };
    }

    if (!isChineseLearningQuestion(text)) {
      return {
        reply: "I’m your Chinese learning tutor, so I can help with Chinese words, grammar, pinyin, pronunciation, reading, listening, exercises, and HSK practice.",
        audioItems: [],
      };
    }

    if (/standard course|book|lesson|第\s*\d+\s*课|课文|source|教材/i.test(text)) {
      const bookLesson = findBookLesson(text);
      if (bookLesson) return { quiz: null, exercise: null, ...answerBookLesson(bookLesson) };
    }

    if (/quiz|测验|小测|考我|test me/i.test(text)) {
      const nextQuiz = makeQuiz(extractHskLevel(text));
      const question = askQuizQuestion(nextQuiz);
      return { quiz: nextQuiz, exercise: null, reply: question.reply, audioItems: question.audioItems, lastTopic: { type: "quiz", level: nextQuiz.level } };
    }

    if (/listening|listen|audio|听力|听写/i.test(text)) return { quiz: null, exercise: null, ...generateListening(text) };
    if (/reading|passage|text|阅读|短文/i.test(text)) return { quiz: null, exercise: null, ...generateReading(text, vocab) };
    if (/^translate\s*:|translate this|translate it|翻译/i.test(text)) return { quiz: null, exercise: null, ...translateRequest(text) };
    if (/exercise|practice|练习|题|fill|multiple|ordering|correction/i.test(text)) return { quiz: null, ...generateExercises(text) };
    if (/pinyin|拼音/i.test(text)) return { quiz: null, exercise: null, ...pinyinForChinese(text, vocab) };
    if (/pronounce|pronunciation|发音|怎么读/i.test(text)) return { quiz: null, exercise: null, ...answerPronunciation(text, vocab) };
    const meaning = sentenceMeaning(text);
    if (/what does|什么意思|meaning/i.test(text) && meaning) return { quiz: null, exercise: null, ...meaning };
    if (text.includes("的") && text.includes("地") && text.includes("得")) return { quiz: null, exercise: null, ...answerDeParticles() };

    const grammar = findGrammar(text);
    if (/example|examples|例句|造句/i.test(text) && grammar) {
      const topic = { type: "grammar", lesson: grammar };
      return moreExamplesForTopic(topic, activeState, exampleCountFromText(text));
    }
    if (/grammar|结构|语法|怎么用|difference|区别|explain|use|pattern/i.test(text) && grammar) return { quiz: null, exercise: null, ...answerGrammar(grammar, text) };

    if (/hsk|prepare|preparation|考试|备考/i.test(text)) {
      const level = extractHskLevel(text);
      return {
        reply: `HSK ${level} prep plan:
1. Review ${Math.min(wordsForLevel(level).length, 20)} words a day.
2. Make 5 sentences with new words.
3. Practice one grammar point.
4. Read one short passage.
5. Do a 5-question quiz.

Ask “Quiz me on HSK ${level}” when you are ready.`,
        audioItems: [],
        lastTopic: { type: "hsk", level, recentHistory },
      };
    }

    const vocabMatches = englishMatch ? [englishMatch] : findVocabulary(text, vocab);
    const cleanChinese = chineseOnly(text).replace(/[，。！？、；：]/g, "");
    if (vocabMatches.length && vocabMatches[0].char === cleanChinese) {
      return { quiz: null, exercise: null, ...answerVocabulary(vocabMatches[0], { detailed: /explain|detail|详细/i.test(text) }) };
    }
    if (vocabMatches.length && /what is|how do you say|translate|what does|meaning|mean|意思|拼音|怎么读|word|词|vocab|vocabulary/i.test(text)) {
      return { quiz: null, exercise: null, ...answerVocabulary(vocabMatches[0], { detailed: /explain|detail|详细/i.test(text) }) };
    }

    const cn = chineseOnly(text);
    if (cn.length >= 4 || /correct|fix|改|纠正|对吗|自然吗/i.test(text)) return { quiz: null, exercise: null, ...correctSentence(text, vocab) };

    if (vocabMatches.length) return { quiz: null, exercise: null, ...answerVocabulary(vocabMatches[0], { detailed: false }) };

    if (/what is|how do you say|translate|what does|meaning|mean|意思|word|词|vocab|vocabulary/i.test(text)) {
      return {
        quiz: null,
        exercise: null,
        reply: "Let me check the correct Chinese meaning.\n\nI do not see this item in the verified HSK 1-4 vocabulary database, so I do not want to guess. Try a simpler word, send the Chinese characters, or add it to data/admin_content.json as extra vocabulary.",
        audioItems: [],
      };
    }

    return {
      quiz: null,
      exercise: null,
      reply: "I’m your Chinese tutor, so I can help with Chinese words, grammar, reading, listening, exercises, and sentence correction.",
      audioItems: [],
    };
  };

  const startNewChat = () => {
    if (!window.confirm("Start a new chat? This will clear the current conversation.")) return;
    const freshMessages = [{ role: "assistant", content: TUTOR_WELCOME, audioItems: [] }];
    const freshState = createTutorState();
    activeStandaloneAudio?.pause();
    setInput("");
    setLoading(false);
    setMessages(freshMessages);
    setConversationHistory(compactTutorHistory(freshMessages));
    setTutorState(freshState);
    writeStorage(TUTOR_CONVERSATION_KEY, freshMessages);
    writeStorage(TUTOR_STATE_KEY, freshState);
  };

  const send = async (text = input) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    const userMessage = { role: "user", content: trimmed };
    setMessages((items) => [...items, userMessage]);
    setLoading(true);
    try {
      const historyForModel = [...conversationHistory.slice(-20), { role: "user", content: trimmed }];
      const verifiedContext = buildVerifiedTutorContext(trimmed, vocab, tutorState);
      let result = null;
      try {
        result = await callTutorModel({
          message: trimmed,
          history: historyForModel,
          state: tutorState,
          verifiedContext,
          language,
        });
      } catch (error) {
        console.warn("HanZi Tutor API unavailable; using local tutor fallback.", error);
      }
      if (!result) {
        result = replyFor(trimmed, tutorState.quizMode, tutorState.lastExercise, tutorState.currentTopic, historyForModel, tutorState);
      }
      const nextState = updateTutorState(tutorState, result);
      setTutorState(nextState);
      if (result.activity) onActivity?.(result.activity.type, result.activity.payload);
      const assistantMessage = { role: "assistant", content: result.reply, audioItems: result.audioItems || [] };
      setMessages((items) => [...items, assistantMessage]);
      setConversationHistory([...historyForModel, { role: "assistant", content: result.reply }].slice(-40));
    } finally {
      setLoading(false);
    }
  };

  const prompts = [
    "What is food in Chinese?",
    "Explain 虽然...但是",
    "Create an HSK 2 reading text",
    "Listening practice HSK 2",
    "Quiz me on HSK 4",
    "Correct: 我昨天不去学校。",
    "HSK 1 prep",
    "HSK 2 prep",
    "HSK 3 prep",
    "HSK 4 prep",
  ];

  return (
    <section className="hz-section" style={{ maxWidth: 920 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h1 className="hz-heading">{tr("tutorTitle")}</h1>
          <p className="hz-muted">{tr("tutorSubtitle")}</p>
        </div>
        <button className="hz-tab" onClick={startNewChat}>New Chat</button>
      </div>
      <div className="hz-toolbar">
        {["Explain a Word", "Grammar Help", "Reading Practice", "Listening Practice", "Quiz Me", "Correct My Sentence", "HSK 1", "HSK 2", "HSK 3", "HSK 4"].map((label, index) => (
          <button key={label} className="hz-tab" onClick={() => setInput(prompts[index])}>{label}</button>
        ))}
      </div>
      <div className="hz-card" style={{ overflow: "hidden" }}>
        <div className="hz-chat">
          {messages.map((message, index) => (
            <div key={index} className={`hz-bubble ${message.role === "user" ? "user" : ""}`}>
              {message.role === "assistant" && <b style={{ color: "#F5C842" }}>HanZi Tutor{"\n"}</b>}
              <InteractiveChineseText text={message.content} />
              {message.audioItems?.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
                  {message.audioItems.map((item, audioIndex) => (
                    <button key={`${item.label}-${audioIndex}`} className={speak.buttonClass(`tutor-${index}-${audioIndex}`)} onClick={() => speak(item.text, settings.audio.voiceSpeed || 0.85, `tutor-${index}-${audioIndex}`)}>{speak.label(`tutor-${index}-${audioIndex}`, `Play Audio ${audioIndex + 1}`)}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && <div className="hz-bubble"><b style={{ color: "#F5C842" }}>HanZi Tutor{"\n"}</b><span style={{ animation: "typing 1s infinite" }}>{tr("thinking")}</span></div>}
          <div ref={bottomRef} />
        </div>
        <div style={{ display: "flex", gap: 10, padding: 16, borderTop: "1px solid rgba(212,175,55,.12)" }}>
          <input className="hz-input" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} placeholder={tutorState.quizMode ? "Answer the quiz question..." : "Ask about grammar, vocab, reading, exercises, or sentence correction..."} />
          <button className="hz-red-btn" disabled={loading} style={{ opacity: loading ? 0.55 : 1 }} onClick={() => send()}>{loading ? "..." : tr("send")}</button>
        </div>
      </div>
    </section>
  );
}

function ListeningSection({ onActivity, premium = false, onUpgrade }) {
  const [level, setLevel] = useState(1);
  const [sentenceIndex, setSentenceIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const texts = {
    1: ["今天我去学校学习中文。", "老师说，学习要慢慢来。", "下课以后，我和朋友一起复习新词。"],
    2: ["周末我想去公园。", "如果下雨，我就在家听中文。", "我会写下听到的句子。"],
    3: ["为了提高听力，我每天听一段短文。", "第一遍我只听大意。", "第二遍我写下关键词。"],
    4: ["准备HSK考试需要稳定的练习。", "听力训练可以帮助你熟悉真实语速。", "如果听不懂，可以先放慢速度再重复。"],
  };
  const sentences = texts[level] || texts[1];
  const fullText = sentences.join("");
  const speak = useChineseSpeech();

  return (
    <section className="hz-section">
      <h1 className="hz-heading">Listening Practice</h1>
      <p className="hz-muted">Practice AI voice playback, replay, slow listening, sentence-by-sentence listening, dictation, and fill-in-the-blank questions.</p>
      {!premium && (
        <div className="hz-card" style={{ padding: 14, margin: "16px 0", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span className="hz-muted">Free access includes limited HSK 1 listening. Upgrade for all HSK 1-5 listening practice.</span>
          <button className="hz-gold-btn" onClick={onUpgrade}>View Plans</button>
        </div>
      )}
      <div className="hz-toolbar">
        {LEVELS.map((item) => <button key={item} disabled={!premium && item !== 1} className={`hz-tab ${level === item ? "active" : ""}`} onClick={() => { setLevel(item); setSentenceIndex(0); }}>HSK {item}</button>)}
      </div>
      <div className="hz-two-col">
        <div className="hz-card" style={{ padding: 24 }}>
          <h2 style={{ color: "#F5C842", marginTop: 0 }}>HSK {level} Listening</h2>
          <p style={{ font: "1.15rem/2 'Noto Serif SC',serif" }}>{fullText}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={speak.buttonClass(`legacy-listening-${level}-play`)} onClick={() => speak(fullText, 0.85, `legacy-listening-${level}-play`)}>{speak.label(`legacy-listening-${level}-play`)}</button>
            <button className={speak.buttonClass(`legacy-listening-${level}-slow`)} onClick={() => speak(fullText, 0.62, `legacy-listening-${level}-slow`)}>{speak.label(`legacy-listening-${level}-slow`, "Slow", "Stop Slow")}</button>
            <button className="hz-tab" onClick={() => setShowPinyin((value) => !value)}>{showPinyin ? "Hide Pinyin" : "Show Pinyin"}</button>
            <button className="hz-tab" onClick={() => setShowTranslation((value) => !value)}>{showTranslation ? "Hide Translation" : "Show Translation"}</button>
          </div>
          <div style={{ marginTop: 20 }}>
            <h3 style={{ color: "#F5C842" }}>Sentence by sentence</h3>
            <p className="hz-muted">{sentenceIndex + 1}. {sentences[sentenceIndex]}</p>
            <button className={speak.buttonClass(`legacy-listening-${level}-${sentenceIndex}`)} onClick={() => speak(sentences[sentenceIndex], 0.85, `legacy-listening-${level}-${sentenceIndex}`)}>{speak.label(`legacy-listening-${level}-${sentenceIndex}`)}</button>
            <button className="hz-tab" style={{ marginLeft: 8 }} onClick={() => setSentenceIndex((value) => (value + 1) % sentences.length)}>Next Sentence</button>
          </div>
        </div>
        <div className="hz-card" style={{ padding: 24 }}>
          <h3 style={{ color: "#F5C842", marginTop: 0 }}>Dictation</h3>
          <p className="hz-muted">Listen and type what you hear.</p>
          <input className="hz-input" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Type the Chinese sentence..." />
          <h3 style={{ color: "#F5C842" }}>Fill in the blank</h3>
          <p style={{ font: "1.05rem/1.8 'Noto Serif SC',serif" }}>今天我去____学习中文。</p>
          <button className="hz-gold-btn" onClick={() => onActivity?.("listening", { level, text: fullText })}>Mark Listening Viewed</button>
        </div>
      </div>
    </section>
  );
}

const normalizeAnswerText = (value = "") => value
  .toString()
  .toLowerCase()
  .replace(/[，。！？、；：,.!?;:"'“”‘’\s]/g, "")
  .trim();

function answerMatches(input, expected) {
  const cleanInput = normalizeAnswerText(input);
  const cleanExpected = normalizeAnswerText(expected);
  if (!cleanInput || !cleanExpected) return false;
  if (cleanInput.includes(cleanExpected) || cleanExpected.includes(cleanInput)) return true;
  return expected
    .split(/[;\/,|]+/)
    .map((item) => normalizeAnswerText(item))
    .filter(Boolean)
    .some((item) => cleanInput.includes(item) || item.includes(cleanInput));
}

function textForPronunciationMode(text, mode) {
  if (mode !== "character") return text;
  return String(text || "")
    .split("")
    .map((char) => isChineseChar(char) ? `${char} ` : char)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function rateForPronunciationMode(rate, mode) {
  if (mode === "slow") return Math.min(Number(rate) || 0.75, 0.75);
  if (mode === "character") return Math.min(Number(rate) || 0.5, 0.5);
  return Number(rate) || 1;
}

function roleVoiceForLabel(label = "") {
  const lower = String(label).toLowerCase();
  if (/teacher|è€å¸ˆ/.test(lower)) return "shimmer";
  if (/shop|store|åº—|shopkeeper/.test(lower)) return "echo";
  if (/taxi|driver|å¸æœº/.test(lower)) return "echo";
  if (/waiter|restaurant|hotel|staff|æœåŠ¡|å‰å°/.test(lower)) return "nova";
  if (/business|client|manager|ç»ç†|å®¢æˆ·/.test(lower)) return "onyx";
  return ROLEPLAY_VOICES[label] || null;
}

function useChineseSpeech(settings = createDefaultSettings()) {
  const [activeKey, setActiveKey] = useState(null);
  const [loadingKey, setLoadingKey] = useState(null);
  const audioRef = useRef(null);
  const speak = async (text, rate = settings.audio.voiceSpeed || 1, key = `${text}-${rate}`, options = {}) => {
    if (!text) return;
    const mode = options.pronunciationMode || settings.audio.pronunciationMode || "natural";
    const ttsText = textForPronunciationMode(text, mode);
    const ttsRate = rateForPronunciationMode(rate, mode);
    const voice = normalizeTtsVoice(options.voice || settings.audio.voiceType);
    if (activeKey === key) {
      audioRef.current?.pause();
      audioRef.current && (audioRef.current.currentTime = 0);
      window.speechSynthesis?.cancel();
      setActiveKey(null);
      setLoadingKey(null);
      return;
    }
    audioRef.current?.pause();
    setActiveKey(key);
    const cacheKey = JSON.stringify({ text: ttsText, rate: ttsRate, voice, mode });
    if (!USE_OPENAI_TTS) {
      console.log("[HanZi TTS frontend] selectedVoice =", normalizeTtsVoice(settings.audio.voiceType));
      console.log("[HanZi TTS frontend] request voice", voice, { provider: "browser", cacheKey });
      showAudioNotice();
      const started = playBrowserTts(ttsText, { voice, speed: ttsRate, volume: settings.audio.volume ?? 1, key, onEnd: () => setActiveKey((current) => current === key ? null : current) });
      if (!started) {
        console.error("[HanZi TTS frontend] Browser speechSynthesis is unavailable.");
        setActiveKey(null);
      }
      return;
    }
    setLoadingKey(key);
    console.log("[HanZi TTS frontend] selectedVoice =", normalizeTtsVoice(settings.audio.voiceType));
    console.log("[HanZi TTS frontend] request voice", voice, { provider: "openai", cacheKey });
    try {
      let url = ttsAudioCache.get(cacheKey);
      if (!url) {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: ttsText, voice, speed: ttsRate, pronunciationMode: mode }),
        });
        if (!response.ok) throw new Error(`TTS failed with ${response.status}`);
        const blob = await response.blob();
        url = URL.createObjectURL(blob);
        ttsAudioCache.set(cacheKey, url);
        if (ttsAudioCache.size > 120) {
          const oldest = ttsAudioCache.keys().next().value;
          URL.revokeObjectURL(ttsAudioCache.get(oldest));
          ttsAudioCache.delete(oldest);
        }
      }
      const audio = new Audio(url);
      audio.volume = settings.audio.volume ?? 1;
      audio.onended = () => setActiveKey((current) => current === key ? null : current);
      audio.onerror = () => setActiveKey((current) => current === key ? null : current);
      audioRef.current = audio;
      setLoadingKey(null);
      await audio.play();
    } catch (error) {
      console.error("[HanZi TTS frontend] OpenAI TTS failed", error);
      setLoadingKey(null);
      showAudioNotice();
      const started = playBrowserTts(ttsText, { voice, speed: ttsRate, volume: settings.audio.volume ?? 1, key, onEnd: () => setActiveKey((current) => current === key ? null : current) });
      if (!started) setActiveKey(null);
    }
  };
  speak.isPlaying = (key) => activeKey === key;
  speak.isLoading = (key) => loadingKey === key;
  speak.label = (key, playLabel = "Play Audio", stopLabel = "Stop") => (
    <span className="hz-audio-label">
      {loadingKey === key && <span className="hz-audio-loading" />}
      {activeKey === key && loadingKey !== key && <span className="hz-wave"><i /><i /><i /></span>}
      {loadingKey === key ? "Generating..." : activeKey === key ? stopLabel : playLabel}
    </span>
  );
  speak.buttonClass = (key, base = "hz-tab") => `${base} hz-audio-control ${activeKey === key ? "active" : ""}`;
  return speak;
}

function AudioNotice() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    let timer = null;
    const onNotice = (event) => {
      setMessage(event.detail || "Premium AI voice is not active yet. Using browser voice.");
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(""), 3200);
    };
    window.addEventListener("hanzi-audio-notice", onNotice);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hanzi-audio-notice", onNotice);
    };
  }, []);
  return message ? <div className="hz-audio-notice">{message}</div> : null;
}

function ListeningSectionV2({ onActivity, premium = false, onUpgrade, settings = createDefaultSettings() }) {
  const [level, setLevel] = useState(1);
  const [mode, setMode] = useState("listening");
  const [itemIndex, setItemIndex] = useState(0);
  const [choice, setChoice] = useState("");
  const [checked, setChecked] = useState(false);
  const [showPinyin, setShowPinyin] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [completed, setCompleted] = useState(() => new Set());
  const items = useMemo(() => mode === "dialogue" ? buildDialogueItems(level) : buildProfessionalListeningItems(level), [level, mode]);
  const availableItems = premium ? items : items.slice(0, 10);
  const item = availableItems[itemIndex] || availableItems[0];
  const speak = useChineseSpeech(settings);

  useEffect(() => {
    setItemIndex(0);
    setChoice("");
    setChecked(false);
    setShowPinyin(false);
    setShowTranslation(false);
  }, [level, mode]);

  if (!item) return null;

  const check = () => {
    if (!choice) return;
    setChecked(true);
    if (!completed.has(item.id)) {
      const next = new Set(completed);
      next.add(item.id);
      setCompleted(next);
      onActivity?.("listening", { level, item, correct: choice === item.answer });
    }
  };

  const nextItem = () => {
    setChoice("");
    setChecked(false);
    setShowPinyin(false);
    setShowTranslation(false);
    setItemIndex((value) => Math.min(availableItems.length - 1, value + 1));
  };
  const playLine = (line, rate = settings.audio.voiceSpeed || 1, key = `line-${line}-${rate}`) => {
    const speaker = line.split("：")[0] || "";
    speak(line.replace(/^.+?：/, ""), rate, key, { voice: roleVoiceForLabel(`${item.title} ${speaker}`) || settings.audio.voiceType });
  };

  return (
    <section className="hz-section">
      <h1 className="hz-heading">Listening Practice</h1>
      <p className="hz-muted">50 verified listening items per HSK level with play/stop audio, slow playback, questions, and explanations.</p>
      {!premium && (
        <div className="hz-card" style={{ padding: 14, margin: "16px 0", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span className="hz-muted">Free access includes the first 10 HSK 1 listening items. Upgrade for all HSK 1-5 listening items.</span>
          <button className="hz-gold-btn" onClick={onUpgrade}>View Plans</button>
        </div>
      )}
      <div className="hz-toolbar">
        {LEVELS.map((itemLevel) => (
          <button key={itemLevel} disabled={!premium && itemLevel !== 1} className={`hz-tab ${level === itemLevel ? "active" : ""}`} onClick={() => setLevel(itemLevel)}>HSK {itemLevel}</button>
        ))}
        <button className={`hz-tab ${mode === "listening" ? "active" : ""}`} onClick={() => setMode("listening")}>Listening</button>
        <button className={`hz-tab ${mode === "dialogue" ? "active" : ""}`} onClick={() => setMode("dialogue")}>Dialogue Listening</button>
        <span className="hz-muted">Item {itemIndex + 1} of {availableItems.length}</span>
      </div>
      <div className="hz-two-col">
        <article className="hz-card" style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <h2 style={{ color: "var(--accent)", margin: 0 }}>HSK {level} {mode === "dialogue" ? "Dialogue" : "Listening"}: {item.title}</h2>
            <LevelBadge level={level} />
          </div>
          {mode === "dialogue" ? (
            <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
              {item.speakers.map(([speaker, line], index) => (
                <div key={`${speaker}-${index}`} className="hz-card" style={{ padding: 12 }}>
                  <b style={{ color: "var(--accent)" }}>{speaker}</b>
                  <p style={{ font: "1.1rem/1.8 'Noto Serif SC',serif", margin: "6px 0" }}><InteractiveChineseText text={line} /></p>
                  <button className={speak.buttonClass(`dialogue-${item.id}-${index}-play`)} onClick={() => playLine(line, settings.audio.voiceSpeed || 0.85, `dialogue-${item.id}-${index}-play`)}>{speak.label(`dialogue-${item.id}-${index}-play`)}</button>
                  <button className={speak.buttonClass(`dialogue-${item.id}-${index}-slow`)} style={{ marginLeft: 8 }} onClick={() => playLine(line, 0.62, `dialogue-${item.id}-${index}-slow`)}>{speak.label(`dialogue-${item.id}-${index}-slow`, "Slow", "Stop Slow")}</button>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ font: "1.25rem/2 'Noto Serif SC',serif", marginTop: 18 }}><InteractiveChineseText text={item.sentence} /></p>
          )}
          {showPinyin && <p className="hz-muted">{item.pinyin}</p>}
          {showTranslation && <p className="hz-muted">{item.translation}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={speak.buttonClass(`listening-${item.id}-play`)} onClick={() => speak(item.sentence, settings.audio.voiceSpeed || 0.85, `listening-${item.id}-play`)}>{speak.label(`listening-${item.id}-play`)}</button>
            <button className={speak.buttonClass(`listening-${item.id}-slow`)} onClick={() => speak(item.sentence, 0.62, `listening-${item.id}-slow`)}>{speak.label(`listening-${item.id}-slow`, "Slow", "Stop Slow")}</button>
            <button className="hz-tab" onClick={() => setShowPinyin((value) => !value)}>{showPinyin ? "Hide Pinyin" : "Show Pinyin"}</button>
            <button className="hz-tab" onClick={() => setShowTranslation((value) => !value)}>{showTranslation ? "Hide Translation" : "Show Translation"}</button>
          </div>
          <div className="hz-card" style={{ padding: 16, marginTop: 20 }}>
            <b style={{ color: "var(--accent)" }}>Vocabulary</b>
            <Breakdown words={(item.vocabulary || []).map((word) => ({ word: word.word, pinyin: word.pinyin, meaning: word.meaning, grammar: "listening" }))} />
            <button className={speak.buttonClass(`listening-${item.id}-sentence`)} onClick={() => speak(item.sentence, settings.audio.voiceSpeed || 0.85, `listening-${item.id}-sentence`)}>{speak.label(`listening-${item.id}-sentence`)}</button>
          </div>
        </article>

        <aside className="hz-card" style={{ padding: 24 }}>
          <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Question</h3>
          <p className="hz-muted">{item.question}</p>
          <div style={{ display: "grid", gap: 8 }}>
            {item.choices.map((option) => (
              <button key={option} className={`hz-choice ${choice === option ? "active" : ""}`} style={{ textAlign: "left" }} onClick={() => { setChoice(option); setChecked(false); }}>{option}</button>
            ))}
          </div>
          <button className="hz-gold-btn" disabled={!choice} style={{ width: "100%", marginTop: 16 }} onClick={check}>Check Answer</button>
          {checked && (
            <div className="hz-card" style={{ padding: 14, marginTop: 14, borderColor: choice === item.answer ? "rgba(76,175,125,.45)" : "rgba(229,57,53,.45)" }}>
              <b style={{ color: choice === item.answer ? "#70C997" : "#FF8A87" }}>{choice === item.answer ? "Correct" : "Not quite"}</b>
              <div className="hz-muted">Answer: {item.answer}</div>
              <div className="hz-muted">{item.explanation}</div>
            </div>
          )}
          <div className="hz-card" style={{ padding: 14, marginTop: 14 }}>
            <b style={{ color: "var(--accent)" }}>Listening Questions</b>
            {(item.questions || []).map((question, index) => <div key={index} className="hz-muted">{index + 1}. {question.question}</div>)}
            <b style={{ color: "var(--accent)", display: "block", marginTop: 12 }}>Answer Key</b>
            {(item.questions || []).map((question, index) => <div key={index} className="hz-muted">{index + 1}. {question.answer}</div>)}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button className="hz-tab" disabled={itemIndex === 0} onClick={() => { setItemIndex((value) => Math.max(0, value - 1)); setChoice(""); setChecked(false); }}>Previous</button>
            <button className="hz-red-btn" disabled={itemIndex >= availableItems.length - 1} onClick={nextItem}>Next</button>
          </div>
        </aside>
      </div>
    </section>
  );
}

function ExerciseSection({ onActivity, premium = false, onUpgrade, settings = createDefaultSettings() }) {
  const [level, setLevel] = useState(1);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [choice, setChoice] = useState("");
  const [checked, setChecked] = useState(false);
  const [completed, setCompleted] = useState(() => new Set());
  const exercises = useMemo(() => buildExerciseItems(level), [level]);
  const availableExercises = exercises.slice(0, 50);
  const exercise = availableExercises[index] || availableExercises[0];
  const speak = useChineseSpeech(settings);
  const hasChoices = Array.isArray(exercise?.choices) && exercise.choices.length > 0;
  const response = hasChoices ? choice : answer;
  const correct = exercise ? answerMatches(response, exercise.answer) : false;
  const atLastExercise = index >= availableExercises.length - 1;

  useEffect(() => {
    setIndex(0);
    setAnswer("");
    setChoice("");
    setChecked(false);
  }, [level]);

  if (!exercise) return null;

  const submit = () => {
    if (!response.trim()) return;
    setChecked(true);
    if (!completed.has(exercise.id)) {
      const next = new Set(completed);
      next.add(exercise.id);
      setCompleted(next);
      onActivity?.("exercise", { level, exercise, correct });
    }
  };

  const next = () => {
    setAnswer("");
    setChoice("");
    setChecked(false);
    setIndex((value) => Math.min(availableExercises.length - 1, value + 1));
  };

  const chinesePrompt = chineseOnly(exercise.prompt).replace(/[，。！？、；：]/g, "");

  return (
    <section className="hz-section">
      <h1 className="hz-heading">Exercises</h1>
      <p className="hz-muted">Level-matched practice: multiple choice, blanks, translation, ordering, correction, matching, dictation, and reading comprehension.</p>
      {!premium && (
        <div className="hz-card" style={{ padding: 14, margin: "16px 0", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span className="hz-muted">Exercises now include 50 level-matched questions per HSK level. Upgrade for full platform access and progress analytics.</span>
          <button className="hz-gold-btn" onClick={onUpgrade}>View Plans</button>
        </div>
      )}
      <div className="hz-toolbar">
        {LEVELS.map((itemLevel) => <button key={itemLevel} disabled={!premium && itemLevel !== 1} className={`hz-tab ${level === itemLevel ? "active" : ""}`} onClick={() => setLevel(itemLevel)}>HSK {itemLevel}</button>)}
        <span className="hz-muted">Exercise {index + 1} of {availableExercises.length}</span>
      </div>

      <div className="hz-two-col">
        <article className="hz-card" style={{ padding: 26 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
            <LevelBadge level={level} />
            <span className="hz-badge" style={{ color: "var(--accent)", background: "rgba(245,200,66,.12)", border: "1px solid var(--border)" }}>{exercise.type}</span>
            <span className="hz-badge" style={{ color: "var(--accent)", background: "rgba(245,200,66,.08)", border: "1px solid var(--border)" }}>Checked answers earn XP</span>
          </div>
          <div className="hz-muted" style={{ marginBottom: 12 }}>Related grammar: {exercise.relatedGrammar || "HSK practice"} · Vocabulary: {(exercise.relatedVocabulary || []).join(", ") || "level vocabulary"}</div>
          <div style={{ font: hasChinese(exercise.prompt) ? "1.16rem/2 'Noto Serif SC',serif" : "1rem/1.8 'Noto Sans SC',sans-serif", whiteSpace: "pre-wrap" }}>{exercise.prompt}</div>
          {chinesePrompt && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <button className={speak.buttonClass(`exercise-${exercise.id}-play`)} onClick={() => speak(chinesePrompt, settings.audio.voiceSpeed || 0.85, `exercise-${exercise.id}-play`)}>{speak.label(`exercise-${exercise.id}-play`)}</button>
              <button className={speak.buttonClass(`exercise-${exercise.id}-slow`)} onClick={() => speak(chinesePrompt, 0.62, `exercise-${exercise.id}-slow`)}>{speak.label(`exercise-${exercise.id}-slow`, "Slow", "Stop Slow")}</button>
            </div>
          )}
          {hasChoices ? (
            <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
              {exercise.choices.map((option) => <button key={option} className={`hz-choice ${choice === option ? "active" : ""}`} style={{ textAlign: "left" }} onClick={() => { setChoice(option); setChecked(false); }}>{option}</button>)}
            </div>
          ) : (
            <textarea className="hz-input" style={{ marginTop: 18, minHeight: 110 }} value={answer} onChange={(event) => { setAnswer(event.target.value); setChecked(false); }} placeholder="Type your answer here..." />
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
            <button className="hz-gold-btn" disabled={(!checked && !response.trim()) || (checked && atLastExercise)} onClick={checked ? next : submit}>{checked ? (atLastExercise ? "Finished" : "Next") : "Check Answer"}</button>
            <button className="hz-tab" disabled={index === 0} onClick={() => { setIndex((value) => Math.max(0, value - 1)); setAnswer(""); setChoice(""); setChecked(false); }}>Previous</button>
          </div>
        </article>

        <aside className="hz-card" style={{ padding: 24 }}>
          <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Feedback</h3>
          {!checked ? (
            <p className="hz-muted">Answer the question and check it to get explanation and XP.</p>
          ) : (
            <div>
              <b style={{ color: correct ? "#70C997" : "#FF8A87" }}>{correct ? "Correct" : "Review this one"}</b>
              <p className="hz-muted">Correct answer: {exercise.answer}</p>
              <p className="hz-muted">{exercise.explanation}</p>
            </div>
          )}
          <div className="hz-card" style={{ padding: 14, marginTop: 16 }}>
            <b style={{ color: "var(--accent)" }}>Included types</b>
            <div className="hz-muted">Multiple choice, fill blank, translation, ordering, correction, word matching, pinyin matching, listening dictation, reading comprehension.</div>
          </div>
        </aside>
      </div>
    </section>
  );
}

const parseExamChoices = (line) => {
  const normalized = line.replace(/^\d+．\s*/, "").trim();
  return [...normalized.matchAll(/([A-F])\s*([^A-F]+?)(?=\s+[A-F]\s|$)/g)]
    .map((match) => ({ key: match[1], text: match[2].trim() }));
};

const listeningTrueFalse = [
  "大门钥匙只有一个。", "夏天洗热水澡更凉快。", "他开车经验很丰富。", "护士工作前要通过考试。", "电影让观众很失望。",
  "小元在北京上班。", "孩子更容易获得快乐。", "他对买的书不满意。", "他们决定不去爬长城了。", "找对方向很重要。",
].map((prompt, index) => ({
  id: `h41329-l${index + 1}`,
  number: index + 1,
  section: "Listening",
  part: "第 一 部 分",
  type: "true_false",
  prompt: `★ ${prompt}`,
  choices: [{ key: "true", text: "对 / True" }, { key: "false", text: "错 / False" }],
  correctAnswer: null,
  transcript: null,
  explanation: "The uploaded PDF does not include this listening transcript or answer key.",
}));

const listeningChoiceLines = [
  "11． A 很干净 B 刚开不久 C 饮料很贵 D 有很多小吃",
  "12． A 发邮件 B 重新 C 寄信给他 D 翻译成中文",
  "13． A 海洋馆 B 动物园 C 森林公园 D 长江大桥",
  "14． A 感冒了 B 觉得难 C 没复习好 D 没报上名",
  "15． A 吃烤鸭 B 倒垃圾 C 搬沙发 D 收拾厨房",
  "16． A 晴天 B 刮风 C 阴天 D 下雪",
  "17． A 铅笔 B 信封 C 笔记 D 词典",
  "18． A 邮局 B 机场 C 火车站 D 高速公路",
  "19． A 很香 B 太咸了 C 特别辣 D 不够甜",
  "20． A 女的在道歉 B 他们在喝酒 C 女的很粗心 D 男的很难过",
  "21． A 牙疼 B 困了 C 丢了钱包 D 找不到眼镜",
  "22． A 要理发 B 在购物 C 想请假 D 在打扫房间",
  "23． A 别着急 B 想睡觉 C 要早出门 D 没听到通知",
  "24． A 房东 B 周校长 C 新同事 D 老周的孙子",
  "25． A 有礼貌 B 很活泼 C 态度积极 D 有责任感",
  "26． A 同学 B 邻居 C 师生 D 顾客和售货员",
  "27． A 很富 B 很热闹 C 污染严重 D 交通不便",
  "28． A 很幽默 B 爱照相 C 比弟弟矮 D 长得像哥哥",
  "29． A 教室内 B 饭店里 C 地铁出口 D 大使馆外面",
  "30． A 很轻松 B 很担心 C 非常兴奋 D 特别紧张",
  "31． A 很漂亮 B 会唱京剧 C 爱弹钢琴 D 在中国留学",
  "32． A 填表格 B 看演出 C 办护照 D 排队买票",
  "33． A 发烧了 B 要出差 C 有约会 D 没写完作业",
  "34． A 换条路 B 迷路了 C 没带礼物 D 想买新车",
  "35． A 哭了 B 没吃饱 C 生病了 D 没睡醒",
  "36． A 停电了 B 忘记密码了 C 卡里钱不够 D 刷卡机坏了",
  "37． A 商场一层 B 电梯左边 C 附近的银行 D 卫生间旁边",
  "38． A 友好的 B 爱好多的 C 会说话的 D 爱听音乐的",
  "39． A 支持 B 后悔 C 不太同意 D 非常讨厌",
  "40． A 买家具 B 做生意 C 选择丈夫 D 女儿的烦恼",
  "41． A 很懒 B 喜欢抽烟 C 十分浪漫 D 很会修东西",
  "42． A 变肥 B 变厚 C 掉颜色 D 穿着不舒服",
  "43． A 放些茶叶 B 用盐水洗 C 多挂会儿 D 少洗几次",
  "44． A 导游 B 警察 C 律师 D 记者",
  "45． A 在郊区 B 很有名 C 有熊猫 D 冬季游客多",
].map((line) => {
  const number = Number(line.match(/^(\d+)/)?.[1]);
  return {
    id: `h41329-l${number}`,
    number,
    section: "Listening",
    part: number <= 25 ? "第 二 部 分" : "第 三 部 分",
    type: "multiple_choice",
    prompt: `Question ${number}: 请听录音后选择正确答案。`,
    choices: parseExamChoices(line),
    correctAnswer: null,
    transcript: null,
    explanation: "The uploaded PDF includes the answer choices, but not the listening audio/script or answer key.",
  };
});

const readingFillQuestions = [
  ["46", "小云，别站在太阳底下，快到这里来，这儿（ ）。", "A 作者 B 竟然 C 皮肤 D 坚持 E 凉快 F 改变"],
  ["47", "互联网的发展极大地（ ）了我们的生活。", "A 作者 B 竟然 C 皮肤 D 坚持 E 凉快 F 改变"],
  ["48", "多吃水果对（ ）好，这是我刚买的葡萄，都洗干净了，吃点儿吧。", "A 作者 B 竟然 C 皮肤 D 坚持 E 凉快 F 改变"],
  ["49", "那部小说中提到的故事，大部分都是（ ）自己经历过的。", "A 作者 B 竟然 C 皮肤 D 坚持 E 凉快 F 改变"],
  ["50", "她一直都很重视这个机会，最后（ ）放弃了，这让我们非常吃惊。", "A 作者 B 竟然 C 皮肤 D 坚持 E 凉快 F 改变"],
  ["51", "A：你最近在减肥吗？看起来瘦了不少。\nB：真的吗？我只比上个月（ ）了两公斤。", "A 危险 B 毕业 C 温度 D 不过 E 轻 F 短信"],
  ["52", "A：小姐，这里是停车场的入口，你站在这里很（ ）。\nB：不好意思，我没注意到，谢谢你。", "A 危险 B 毕业 C 温度 D 不过 E 轻 F 短信"],
  ["53", "A：你马上就要（ ）了吧？将来有什么打算？\nB：我想出国读硕士，正在准备签证的材料呢。", "A 危险 B 毕业 C 温度 D 不过 E 轻 F 短信"],
  ["54", "A：我换好登机牌了，现在去安检，你们回去吧。\nB：好，你下了飞机记得给我们发个（ ）。", "A 危险 B 毕业 C 温度 D 不过 E 轻 F 短信"],
  ["55", "A：你听，广播里的歌真好听，是谁唱的？\nB：声音听着挺熟悉的，（ ）我一下子想不起来了。", "A 危险 B 毕业 C 温度 D 不过 E 轻 F 短信"],
].map(([number, prompt, bank]) => ({
  id: `h41329-r${number}`,
  number: Number(number),
  section: "Reading",
  part: Number(number) <= 50 ? "第 一 部 分 46-50" : "第 一 部 分 51-55",
  type: "fill_blank",
  prompt,
  wordBank: bank,
  choices: parseExamChoices(bank),
  correctAnswer: null,
  explanation: "The uploaded PDF does not include the answer key.",
}));

const readingOrderingQuestions = [
  ["56", ["A 可是一直都占线", "B 我给马经理打了好几次电话了", "C 也不知道他到底是怎么回事"]],
  ["57", ["A 相信不同的人会给出不同的答案", "B 在我看来，只要能做自己喜欢的事，就是幸福", "C 究竟什么是幸福"]],
  ["58", ["A 请您按照“先下后上”的顺序上下车", "B 各位乘客，为了保证您和他人的安全", "C 并注意脚下，照顾好老人和孩子"]],
  ["59", ["A 既能看得清楚，眼睛也不容易累", "B 科学家通过研究发现，一般情况下", "C 人的眼睛和书本的距离为 0.25 米时"]],
  ["60", ["A 我要特别感谢一直支持和帮助我的朋友们", "B 我是不可能取得今天这样的成绩的", "C 没有他们的关心和鼓励"]],
  ["61", ["A 给我们留下很多美好的回忆", "B 写日记是一个很好的习惯", "C 它可以帮我们记住过去发生的事情"]],
  ["62", ["A 我晚点儿才能回去，桌子上有早上剩下的包子", "B 就先吃点儿", "C 冰箱里还有面包，你要是饿了"]],
  ["63", ["A 你这个动作做得还是不太标准，我给你跳一遍", "B 你仔细看着，应该像我这样", "C 先抬胳膊，然后再抬腿"]],
  ["64", ["A 现在只卖 300 块", "B 这种裙子今年非常流行，质量很好", "C 价格也不贵，我找一件您试试吧"]],
  ["65", ["A 每到秋季，随着气温的降低", "B 吸引了很多游客前来观看", "C 这里许多植物的叶子都会由绿变黄或者变红"]],
].map(([number, items]) => ({
  id: `h41329-r${number}`,
  number: Number(number),
  section: "Reading",
  part: "第 二 部 分",
  type: "sentence_ordering",
  prompt: "排列顺序。",
  orderingItems: items,
  correctAnswer: null,
  explanation: "The uploaded PDF does not include the answer key.",
}));

const readingComprehensionQuestions = [
  ["66", "先生，这儿是南京路 106 号没错，可是没有您说的王师傅这个人，您最好再问问，看这个地址是不是正确。", "那位先生：", "A 改国籍了 B 记错号码了 C 没接到客人 D 要找王师傅"],
  ["67", "把你全部的热情和汗水都用到今天的工作中去，将今天的工作做到最好，这才是我们能为明天所做的最理想的准备。", "怎样才能为明天做好准备？", "A 多锻炼 B 及时总结 C 安排好时间 D 今天努力工作"],
  ["68", "当你为自己取得的成绩而得意时，应该想到，有很多人比你更优秀，所以千万不要骄傲；同样，当你为自己的失败而伤心时，你也应该想到，别人也会失败，也会难过，所以千万不要因此失望甚至怀疑自己。", "根据这段话，失败时要：", "A 先找原因 B 懂得拒绝 C 理解别人 D 对自己有信心"],
  ["69", "教育学家建议，父母应该让 3 到 5 岁的孩子认识钱、了解钱的作用，而对于 6 到 10 岁的孩子，要教他们管理自己的钱，并认识到存钱的重要性。", "父母应教 7 岁的孩子：", "A 换零钱 B 不要浪费 C 怎样管钱 D 别随便借钱"],
  ["70", "当你觉得无聊时，就去读书吧。无论是普通杂志，还是著名小说，只要你打开就会发现，世界上有那么多有趣的事情，有那么多不一样的生活。阅读，确实是一件值得花时间去做的事。", "这段话主要谈的是：", "A 怎样写小说 B 阅读的好处 C 语言的艺术 D 作家的性格"],
  ["71", "今年寒假我去广西玩儿了一趟，那里的气候和北方很不同，尽管是冬天，但非常暖和，还能吃到许多新鲜的水果。", "他觉得广西：", "A 冬季不冷 B 经济发展快 C 少数民族多 D 每天都下雨"],
  ["72", "中国有句话叫“不管三七二十一”，意思是说一个人不管现有条件怎么样，也不考虑最终的结果，就做起事来，这样往往会白费力气，得不到自己想要的结果。", "这段话中“白”的意思最可能是：", "A 来得及 B 受不了 C 没有效果 D 误会很深"],
  ["73", "理想能够使人走出困境。一个人在遇到困难时，如果能继续坚持自己的理想，一步步走下去，那么困难对他来说就只是暂时的。", "这段话主要告诉我们，要：", "A 勇敢 B 坚持理想 C 重视方法 D 打好基础"],
  ["74", "很多自行车后面都有一个灯，虽然小，但用处却很大。每当后面汽车的灯光照到它时，它就会发光，这样就能提醒司机前方有人。", "自行车后灯可以：", "A 提高车速 B 减少堵车 C 节约用电 D 引起司机注意"],
  ["75", "输和赢都只是生活的一部分，没有人会永远输，也没有人会一直赢。生活的关键就是：只要你努力做了，不管是输是赢，都一样精彩。", "根据这段话，可以知道：", "A 要有耐心 B 自信才会赢 C 输赢不重要 D 要多参加活动"],
  ["76", "旅游前最好做个计划，比如要去几个地方，怎么坐车，带哪些东西，一共要玩儿多少天等。把这些都详细计划好，旅游时才会更轻松。", "旅行前，我们应该：", "A 先赚钱 B 提前计划好 C 自备塑料袋 D 和家人讨论"],
  ["77", "我上学校网站看了课表，发现李老师这学期开了一门“汉字与文化”课，我想去听听，之前看过他写的一篇关于这方面的文章，非常有趣。", "他在谈：", "A 选课 B 课前预习 C 汉语语法 D 对汉字的看法"],
  ["78", "要想更快适应新环境，其实有很多办法。例如多和周围的人打招呼，在别人遇到麻烦的时候去帮一把，或者跟别人聊聊他感兴趣的事，这些都可以让身边的人更快地接受你。", "怎样才能更快适应新环境？", "A 要准时 B 常开玩笑 C 多和人聊天儿 D 严格要求自己"],
  ["79", "小蓝，你把这些材料按照时间顺序整理一下，中午吃饭前交给我就行。另外，关医生回来后，让她来我办公室一趟。", "根据这段话，关医生：", "A 很辛苦 B 现在不在 C 不想帮忙 D 没完成任务"],
  ["80", "别人的批评往往能帮助我们认清自己的缺点和错误，所以当我们听到批评时，先不要生气，尤其不要乱发脾气，而是应该冷静地想想他们提出的意见或者建议是否正确，对我们有没有帮助。", "根据这段话，别人的批评能让我们：", "A 适应社会 B 证明自己 C 增加安全感 D 看到自己的错误"],
  ["81", "别人的批评往往能帮助我们认清自己的缺点和错误，所以当我们听到批评时，先不要生气，尤其不要乱发脾气，而是应该冷静地想想他们提出的意见或者建议是否正确，对我们有没有帮助。", "受到批评时，我们首先应该：", "A 表示抱歉 B 原谅别人 C 冷静下来 D 同情别人"],
  ["82", "这家网球馆的服务不错，给我的印象很好。比如说，他们会免费提供饼干和矿泉水，打球打累的时候，我们就可以吃点儿东西休息一下。他们还经常举办一些聚会，邀请的都是在这里打球的人。我参加过几次，每次都玩儿得很开心。", "他觉得那家网球馆怎么样？", "A 太旧了 B 服务很好 C 东西很好吃 D 喝水不方便"],
  ["83", "这家网球馆的服务不错，给我的印象很好。比如说，他们会免费提供饼干和矿泉水，打球打累的时候，我们就可以吃点儿东西休息一下。他们还经常举办一些聚会，邀请的都是在这里打球的人。我参加过几次，每次都玩儿得很开心。", "在聚会上，他：", "A 很安静 B 特别激动 C 打扮得很帅 D 玩儿得很愉快"],
  ["84", "每个人都希望获得更多的东西，但有时候，放弃才是一种聪明的选择。一个人只有两只手，不可能得到所有他想要的东西。只有学会放弃，把自己的能力用到最该做的事情上，才能获得成功。重要的不是你想要得到什么，而是你最后能留下什么。", "根据这段话，每个人都想：", "A 得到表扬 B 获得友谊 C 有更多优点 D 得到更多东西"],
  ["85", "每个人都希望获得更多的东西，但有时候，放弃才是一种聪明的选择。一个人只有两只手，不可能得到所有他想要的东西。只有学会放弃，把自己的能力用到最该做的事情上，才能获得成功。重要的不是你想要得到什么，而是你最后能留下什么。", "根据这段话，想要成功就必须：", "A 懂得放松 B 学会放弃 C 提高标准 D 积累经验"],
].map(([number, passage, prompt, choices]) => ({
  id: `h41329-r${number}`,
  number: Number(number),
  section: "Reading",
  part: "第 三 部 分",
  type: "reading_comprehension",
  passage,
  prompt: `★ ${prompt}`,
  choices: parseExamChoices(choices),
  correctAnswer: null,
  explanation: "The uploaded PDF does not include the answer key.",
}));

const writingOrderingQuestions = [
  ["86", "就想 她从小 成为 一名演员"],
  ["87", "儿童牙膏 十分 受欢迎 这种"],
  ["88", "他 越来越 厉害 得 咳嗽"],
  ["89", "先 调查一下 难道 你没有"],
  ["90", "把 扔进 空瓶子 请 垃圾桶"],
  ["91", "大家的 共同努力 保护环境 需要"],
  ["92", "里 有两棵 张教授家的院子 苹果树"],
  ["93", "大约 1084 公里 北京 离上海"],
  ["94", "很快就被 亲戚朋友们 这个消息 知道了"],
  ["95", "收入 比去年 今年公司的 增加了一倍"],
].map(([number, prompt]) => ({
  id: `h41329-w${number}`,
  number: Number(number),
  section: "Writing",
  part: "第 一 部 分",
  type: "sentence_ordering",
  prompt,
  correctAnswer: null,
  explanation: "The uploaded PDF does not include the answer key.",
}));

const writingPictureQuestions = ["肚子", "擦", "打折", "果汁", "重"].map((word, index) => ({
  id: `h41329-w${96 + index}`,
  number: 96 + index,
  section: "Writing",
  part: "第 二 部 分",
  type: "short_writing",
  prompt: `看图，用词造句：${word}`,
  sourceImageStatus: "Image exists in the PDF page, but the uploaded file text extraction did not expose a reusable image asset.",
  correctAnswer: null,
  explanation: "The uploaded PDF does not include a sample answer.",
}));

const makeHsk5ExamQuestions = () => {
  const words = gradedWordsForLevel(5);
  const choice = (key, text) => ({ key, text });
  return [
    ...Array.from({ length: 8 }, (_, index) => {
      const word = words[index % words.length];
      const distractors = words.slice(index + 1, index + 4);
      return {
        id: `hsk5-listening-${index + 1}`,
        number: index + 1,
        section: "Listening",
        part: "Listening comprehension",
        type: "multiple_choice",
        prompt: `听录音，选择这段话的关键词。`,
        audioText: `这段话主要讨论${word.char}。说话人认为，学习者应该结合背景进行分析，并且用自然的中文表达自己的观点。`,
        choices: [choice("A", word.char), ...distractors.map((item, offset) => choice(String.fromCharCode(66 + offset), item.char))],
        correctAnswer: "A",
        explanation: `Audio explicitly mentions ${word.char}.`,
      };
    }),
    ...Array.from({ length: 8 }, (_, index) => {
      const topic = HSK5_TOPICS[index % HSK5_TOPICS.length];
      const passage = professionalPassageForTopic(5, topic, index);
      return {
        id: `hsk5-reading-${index + 1}`,
        number: index + 9,
        section: "Reading",
        part: "Reading comprehension",
        type: "multiple_choice",
        prompt: `${passage.text}\n\n这篇文章主要讨论什么？`,
        choices: [choice("A", topic), choice("B", "天气变化"), choice("C", "购物计划"), choice("D", "运动比赛")],
        correctAnswer: "A",
        explanation: `The passage topic is ${topic}.`,
      };
    }),
    ...Array.from({ length: 7 }, (_, index) => {
      const lesson = GRAMMAR_CURRICULUM.filter((item) => item.level === 5)[index];
      return {
        id: `hsk5-grammar-${index + 1}`,
        number: index + 17,
        section: "Grammar",
        part: "Grammar and structure",
        type: "multiple_choice",
        prompt: `选择最合适的表达：${lesson?.title || "由此可见"}`,
        choices: [choice("A", lesson?.examples?.[0]?.cn || "由此可见，持续练习很重要。"), choice("B", "昨天我去学校。"), choice("C", "这个苹果很甜。"), choice("D", "他在家。")],
        correctAnswer: "A",
        explanation: `This item checks the HSK 5 pattern ${lesson?.title || "由此可见"}.`,
      };
    }),
    ...Array.from({ length: 7 }, (_, index) => {
      const word = words[(index + 12) % words.length];
      return {
        id: `hsk5-vocab-${index + 1}`,
        number: index + 24,
        section: "Vocabulary",
        part: "Vocabulary usage",
        type: "multiple_choice",
        prompt: `"${word.char}" 的意思最接近：`,
        choices: [choice("A", word.meaning), choice("B", "to eat"), choice("C", "yesterday"), choice("D", "red")],
        correctAnswer: "A",
        explanation: `${word.char} (${word.pinyin}) means ${word.meaning}.`,
      };
    }),
  ];
};

const HSK_EXAMS = [
  {
    id: "hsk5-generated-core",
    title: "HSK 5 HanZi Mock Exam",
    source: "HanZi HSK 5 curriculum; uploaded PDF text layer requires OCR before exact textbook import",
    hskLevel: 5,
    timeLimitMinutes: 90,
    passPercent: 60,
    answerKeyAvailable: true,
    sectionsIncluded: ["Listening", "Reading", "Grammar", "Vocabulary"],
    questions: makeHsk5ExamQuestions(),
  },
  {
    id: "hsk4-h41329",
    title: "HSK 4 真题6（H41329）",
    source: "HSK4 Mock Test 6(H41329)(2).pdf",
    hskLevel: 4,
    timeLimitMinutes: null,
    passPercent: 60,
    answerKeyAvailable: false,
    sectionsIncluded: ["Listening", "Reading", "Writing"],
    questions: [
      ...listeningTrueFalse,
      ...listeningChoiceLines,
      ...readingFillQuestions,
      ...readingOrderingQuestions,
      ...readingComprehensionQuestions,
      ...writingOrderingQuestions,
      ...writingPictureQuestions,
    ],
  },
];

function answerLabel(question, answer) {
  if (answer === undefined || answer === null || answer === "") return "No answer";
  if (question.choices?.length) {
    const choice = question.choices.find((item) => item.key === answer);
    return choice ? `${choice.key}. ${choice.text}` : answer;
  }
  return answer;
}

function scoreExam(exam, answers, startedAt) {
  const gradable = exam.questions.filter((question) => question.correctAnswer);
  const wrongAnswers = [];
  let correct = 0;
  gradable.forEach((question) => {
    const userAnswer = answers[question.id] || "";
    const isCorrect = normalizeAnswerText(userAnswer) === normalizeAnswerText(question.correctAnswer);
    if (isCorrect) correct += 1;
    else wrongAnswers.push({ question, userAnswer, correctAnswer: question.correctAnswer });
  });
  const percentage = gradable.length ? Math.round((correct / gradable.length) * 100) : null;
  const sectionScore = {};
  exam.sectionsIncluded.forEach((section) => {
    const sectionQuestions = gradable.filter((question) => question.section === section);
    const sectionCorrect = sectionQuestions.filter((question) => normalizeAnswerText(answers[question.id] || "") === normalizeAnswerText(question.correctAnswer)).length;
    sectionScore[section] = sectionQuestions.length ? { correct: sectionCorrect, total: sectionQuestions.length } : { correct: null, total: 0 };
  });
  return {
    examId: exam.id,
    examTitle: exam.title,
    hskLevel: exam.hskLevel,
    date: new Date().toISOString(),
    startedAt,
    completedAt: new Date().toISOString(),
    timeUsedSeconds: startedAt ? Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)) : 0,
    totalQuestions: exam.questions.length,
    answeredCount: Object.values(answers).filter(Boolean).length,
    gradableCount: gradable.length,
    unscoredCount: exam.questions.length - gradable.length,
    correct,
    wrong: wrongAnswers.length,
    percentage,
    pass: percentage === null ? null : percentage >= exam.passPercent,
    sectionScore,
    answers,
    wrongAnswers,
  };
}

function ExamSection({ progress, onActivity, onReviewWithTutor, settings = createDefaultSettings() }) {
  const [view, setView] = useState("list");
  const [exam, setExam] = useState(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [flagged, setFlagged] = useState({});
  const [startedAt, setStartedAt] = useState(null);
  const [result, setResult] = useState(null);
  const speak = useChineseSpeech(settings);
  const activeQuestion = exam?.questions[index];
  const activeAttempts = readStorage(EXAM_ATTEMPTS_KEY, {});

  useEffect(() => {
    if (!exam || view !== "take") return;
    const attempts = readStorage(EXAM_ATTEMPTS_KEY, {});
    attempts[exam.id] = { answers, flagged, index, startedAt };
    writeStorage(EXAM_ATTEMPTS_KEY, attempts);
  }, [answers, flagged, index, startedAt, exam, view]);

  const startExam = (item, retake = false) => {
    const saved = !retake ? activeAttempts[item.id] : null;
    setExam(item);
    setAnswers(saved?.answers || {});
    setFlagged(saved?.flagged || {});
    setIndex(saved?.index || 0);
    setStartedAt(saved?.startedAt || new Date().toISOString());
    setResult(null);
    setView("take");
  };

  const submitExam = () => {
    if (!exam || !window.confirm("Submit exam now? You cannot change answers after submission.")) return;
    const nextResult = scoreExam(exam, answers, startedAt);
    setResult(nextResult);
    const attempts = readStorage(EXAM_ATTEMPTS_KEY, {});
    delete attempts[exam.id];
    writeStorage(EXAM_ATTEMPTS_KEY, attempts);
    onActivity?.("exam", { exam, result: nextResult });
    setView("result");
  };

  const setAnswer = (value) => setAnswers((current) => ({ ...current, [activeQuestion.id]: value }));
  const setTextAnswer = (event) => setAnswer(event.target.value);
  const answeredCount = exam ? exam.questions.filter((question) => answers[question.id]).length : 0;

  if (view === "history") {
    const history = progress?.examHistory || [];
    return (
      <section className="hz-section">
        <h1 className="hz-heading">Exam History</h1>
        <button className="hz-tab" onClick={() => setView("list")}>Back to Exams</button>
        <div className="hz-grid" style={{ marginTop: 18 }}>
          {history.length ? history.map((item) => (
            <div key={`${item.examId}-${item.date}`} className="hz-card" style={{ padding: 20 }}>
              <b style={{ color: "var(--accent)" }}>{item.examTitle}</b>
              <p className="hz-muted">{new Date(item.date).toLocaleString()}</p>
              <p className="hz-muted">Score: {item.percentage === null ? "Unscored" : `${item.percentage}%`} · {item.pass === null ? "Answer key unavailable" : item.pass ? "Pass" : "Fail"}</p>
              <button className="hz-tab" onClick={() => { setResult(item); setExam(HSK_EXAMS.find((candidate) => candidate.id === item.examId)); setView("correction"); }}>View Correction</button>
            </div>
          )) : <p className="hz-muted">No completed exams yet.</p>}
        </div>
      </section>
    );
  }

  if (view === "mistakes") {
    const mistakes = progress?.mistakeReview || [];
    return (
      <section className="hz-section">
        <h1 className="hz-heading">Mistake Review</h1>
        <button className="hz-tab" onClick={() => setView("list")}>Back to Exams</button>
        <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
          {mistakes.length ? mistakes.map((mistake, mistakeIndex) => (
            <div key={`${mistake.questionId}-${mistakeIndex}`} className="hz-card" style={{ padding: 18 }}>
              <b style={{ color: "var(--accent)" }}>{mistake.skillType} · HSK {mistake.hskLevel}</b>
              <p>{mistake.question}</p>
              <p className="hz-muted">Your answer: {mistake.userAnswer}</p>
              <p className="hz-muted">Correct answer: {mistake.correctAnswer}</p>
              <p className="hz-muted">{mistake.explanation}</p>
            </div>
          )) : <p className="hz-muted">No auto-scored mistakes yet. This imported mock exam has no answer key in the uploaded PDF.</p>}
        </div>
      </section>
    );
  }

  if (view === "take" && exam && activeQuestion) {
    const isListening = activeQuestion.section === "Listening";
    const currentAnswer = answers[activeQuestion.id] || "";
    return (
      <section className="hz-section">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h1 className="hz-heading">{exam.title}</h1>
            <p className="hz-muted">Question {index + 1} of {exam.questions.length} · Answered {answeredCount}/{exam.questions.length}</p>
          </div>
          <button className="hz-red-btn" onClick={submitExam}>Submit Exam</button>
        </div>
        <div className="hz-two-col" style={{ marginTop: 18 }}>
          <article className="hz-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
              <LevelBadge level={exam.hskLevel} />
              <span className="hz-badge" style={{ color: "var(--accent)", border: "1px solid var(--border)" }}>{activeQuestion.section}</span>
              <span className="hz-badge" style={{ color: "var(--accent)", border: "1px solid var(--border)" }}>{activeQuestion.part}</span>
              <button className="hz-tab" onClick={() => setFlagged((current) => ({ ...current, [activeQuestion.id]: !current[activeQuestion.id] }))}>{flagged[activeQuestion.id] ? "★ Flagged" : "☆ Flag"}</button>
            </div>
            {isListening && (
              <div className="hz-card" style={{ padding: 14, marginBottom: 16 }}>
                {activeQuestion.audioText ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className={speak.buttonClass(`exam-${activeQuestion.id}-play`)} onClick={() => speak(activeQuestion.audioText, 0.85, `exam-${activeQuestion.id}-play`)}>{speak.label(`exam-${activeQuestion.id}-play`)}</button>
                    <button className={speak.buttonClass(`exam-${activeQuestion.id}-slow`)} onClick={() => speak(activeQuestion.audioText, 0.62, `exam-${activeQuestion.id}-slow`)}>{speak.label(`exam-${activeQuestion.id}-slow`, "Slow", "Stop Slow")}</button>
                  </div>
                ) : (
                  <p className="hz-muted">Listening audio/script was not included in the uploaded PDF text layer, so playback is unavailable for this imported file.</p>
                )}
              </div>
            )}
            {activeQuestion.passage && <p style={{ font: "1.05rem/2 'Noto Serif SC',serif", whiteSpace: "pre-wrap" }}>{activeQuestion.passage}</p>}
            <h2 style={{ color: "var(--accent)", marginTop: 0 }}>#{activeQuestion.number}</h2>
            <p style={{ font: "1.12rem/2 'Noto Serif SC',serif", whiteSpace: "pre-wrap" }}>{activeQuestion.prompt}</p>
            {activeQuestion.wordBank && <p className="hz-muted">Word bank: {activeQuestion.wordBank}</p>}
            {activeQuestion.orderingItems && (
              <div style={{ display: "grid", gap: 8 }}>
                {activeQuestion.orderingItems.map((item) => <div key={item} className="hz-card" style={{ padding: 10 }}>{item}</div>)}
              </div>
            )}
            {activeQuestion.sourceImageStatus && <p className="hz-muted">{activeQuestion.sourceImageStatus}</p>}
            {activeQuestion.choices?.length ? (
              <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
                {activeQuestion.choices.map((choice) => (
                  <button key={choice.key} className={`hz-choice ${currentAnswer === choice.key ? "active" : ""}`} style={{ textAlign: "left" }} onClick={() => setAnswer(choice.key)}>
                    {choice.key}. {choice.text}
                  </button>
                ))}
              </div>
            ) : (
              <textarea className="hz-input" style={{ minHeight: 130, marginTop: 16 }} value={currentAnswer} onChange={setTextAnswer} placeholder="Type your answer..." />
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
              <button className="hz-tab" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>Previous</button>
              <button className="hz-gold-btn" disabled={index >= exam.questions.length - 1} onClick={() => setIndex((value) => Math.min(exam.questions.length - 1, value + 1))}>Next</button>
            </div>
          </article>
          <aside className="hz-card" style={{ padding: 20 }}>
            <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Progress</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 6, maxHeight: 420, overflowY: "auto" }}>
              {exam.questions.map((question, qIndex) => (
                <button key={question.id} className={`hz-tab ${qIndex === index ? "active" : ""}`} style={{ padding: 7, color: flagged[question.id] ? "var(--danger)" : undefined }} onClick={() => setIndex(qIndex)}>
                  {question.number}{answers[question.id] ? "✓" : ""}{flagged[question.id] ? "★" : ""}
                </button>
              ))}
            </div>
          </aside>
        </div>
      </section>
    );
  }

  if ((view === "result" || view === "correction") && result && exam) {
    const showCorrection = view === "correction";
    return (
      <section className="hz-section">
        <h1 className="hz-heading">{showCorrection ? "Exam Correction" : "Exam Result"}</h1>
        <div className="hz-card" style={{ padding: 22, marginBottom: 18 }}>
          <h2 style={{ color: "var(--accent)", marginTop: 0 }}>{result.examTitle}</h2>
          <div className="hz-grid">
            <div><b>Total score</b><p className="hz-muted">{result.percentage === null ? "Unscored" : `${result.percentage}%`}</p></div>
            <div><b>Pass / Fail</b><p className="hz-muted">{result.pass === null ? "Answer key unavailable" : result.pass ? "Pass" : "Fail"}</p></div>
            <div><b>Answered</b><p className="hz-muted">{result.answeredCount}/{result.totalQuestions}</p></div>
            <div><b>Time used</b><p className="hz-muted">{Math.floor(result.timeUsedSeconds / 60)} min {result.timeUsedSeconds % 60}s</p></div>
          </div>
          <p className="hz-muted">Correct: {result.gradableCount ? result.correct : "Unavailable"} · Wrong: {result.gradableCount ? result.wrong : "Unavailable"} · Unscored: {result.unscoredCount}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="hz-gold-btn" onClick={() => setView("correction")}>View Full Correction</button>
            <button className="hz-tab" onClick={() => startExam(exam, true)}>Retake Exam</button>
            <button className="hz-tab" onClick={() => onReviewWithTutor?.(result, exam)}>Review mistakes with AI Tutor</button>
            <button className="hz-tab" onClick={() => setView("list")}>Back to Exams</button>
          </div>
        </div>
        {showCorrection && (
          <div style={{ display: "grid", gap: 12 }}>
            {exam.questions.map((question) => {
              const userAnswer = result.answers?.[question.id] || "";
              const isCorrect = question.correctAnswer && normalizeAnswerText(userAnswer) === normalizeAnswerText(question.correctAnswer);
              return (
                <div key={question.id} className="hz-card" style={{ padding: 18, borderColor: question.correctAnswer ? (isCorrect ? "rgba(76,175,125,.45)" : "rgba(229,57,53,.45)") : "var(--border)" }}>
                  <b style={{ color: "var(--accent)" }}>#{question.number} · {question.section}</b>
                  {question.passage && <p className="hz-muted" style={{ whiteSpace: "pre-wrap" }}>{question.passage}</p>}
                  <p style={{ whiteSpace: "pre-wrap" }}>{question.prompt}</p>
                  <p className="hz-muted">Your answer: {answerLabel(question, userAnswer)}</p>
                  <p className="hz-muted">Correct answer: {question.correctAnswer ? answerLabel(question, question.correctAnswer) : "Not available in uploaded PDF"}</p>
                  {question.section === "Listening" && <p className="hz-muted">Transcript: {question.transcript || "Not available in uploaded PDF"}</p>}
                  <p className="hz-muted">Explanation: {question.correctAnswer ? question.explanation : "This item is saved for manual review because the uploaded PDF did not include an answer key."}</p>
                  <p className="hz-muted">Strategy: Review the question type, note key vocabulary, and compare your answer once an official key is added.</p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  }

  if (view === "start" && exam) {
    return (
      <section className="hz-section">
        <button className="hz-tab" onClick={() => setView("list")}>Back</button>
        <div className="hz-card" style={{ padding: 28, marginTop: 18 }}>
          <LevelBadge level={exam.hskLevel} />
          <h1 className="hz-heading">{exam.title}</h1>
          <p className="hz-muted">Source: {exam.source}</p>
          <div className="hz-grid">
            <div><b>Questions</b><p className="hz-muted">{exam.questions.length}</p></div>
            <div><b>Time limit</b><p className="hz-muted">{exam.timeLimitMinutes ? `${exam.timeLimitMinutes} minutes` : "Not listed in uploaded PDF"}</p></div>
            <div><b>Sections</b><p className="hz-muted">{exam.sectionsIncluded.join(", ")}</p></div>
            <div><b>Answer key</b><p className="hz-muted">{exam.answerKeyAvailable ? "Available" : "Not included in uploaded PDF"}</p></div>
          </div>
          <p className="hz-muted">Answers are saved while you take the exam. The app will not show answers or listening transcripts before submission.</p>
          <button className="hz-gold-btn" onClick={() => startExam(exam)}>Start Exam</button>
        </div>
      </section>
    );
  }

  return (
    <section className="hz-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="hz-heading">Exam</h1>
          <p className="hz-muted">Interactive HSK exams imported from uploaded materials. Content is source-first; missing answer keys are never guessed.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="hz-tab" onClick={() => setView("history")}>Exam History</button>
          <button className="hz-tab" onClick={() => setView("mistakes")}>Mistake Review</button>
        </div>
      </div>
      <div className="hz-grid" style={{ marginTop: 20 }}>
        {LEVELS.map((level) => (
          <div key={level} className="hz-card" style={{ padding: 20, opacity: level === 4 ? 1 : 0.65 }}>
            <LevelBadge level={level} />
            <h3>HSK {level} Exam</h3>
            <p className="hz-muted">{level === 4 ? "1 uploaded mock exam available." : "Upload an exam file to add this level."}</p>
          </div>
        ))}
      </div>
      <h2 style={{ color: "var(--accent)", marginTop: 28 }}>Uploaded Mock Exams</h2>
      <div className="hz-grid">
        {HSK_EXAMS.map((item) => (
          <div key={item.id} className="hz-card hover" style={{ padding: 22 }}>
            <LevelBadge level={item.hskLevel} />
            <h3 style={{ color: "var(--accent)" }}>{item.title}</h3>
            <p className="hz-muted">{item.questions.length} questions · {item.sectionsIncluded.join(", ")}</p>
            <p className="hz-muted">Answer key: {item.answerKeyAvailable ? "Available" : "Not included in uploaded PDF"}</p>
            <button className="hz-gold-btn" onClick={() => { setExam(item); setView("start"); }}>Open Exam</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function PremiumGate({ language = "English", onStartTrial, onSubscribe }) {
  const tr = (key) => uiText(language, key);
  return (
    <section className="hz-premium-gate">
      <div className="hz-card" style={{ padding: 30, width: "min(620px,100%)", textAlign: "center" }}>
        <div style={{ color: "#F5C842", font: "700 2rem/1.2 'Noto Serif SC',serif", marginBottom: 12 }}>HanZi Tutor Premium</div>
        <p style={{ fontSize: "1.05rem", lineHeight: 1.7 }}>
          AI Tutor is available only in Premium. Start your 7-day free trial or upgrade now.
        </p>
        <p className="hz-muted">Premium unlocks unlimited AI conversations, smart corrections, personalized learning, generated quizzes, and AI reading/listening help.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginTop: 22 }}>
          <button className="hz-tab" onClick={onStartTrial}>{tr("startFreeTrial")}</button>
          <button className="hz-gold-btn" onClick={onSubscribe}>{tr("upgradePlan")}</button>
        </div>
      </div>
    </section>
  );
}

function PricingPage({ user, progress, language = "English", onChoosePlan, onStartTrial }) {
  const current = subscriptionName(progress);
  const tr = (key) => uiText(language, key);
  const trialUsed = progress?.subscription?.trialUsed;
  const trialActive = progress?.subscription?.status === "trial" && subscriptionIsPremium(progress);
  const [periods, setPeriods] = useState({ standard: "monthly", premium: "monthly" });
  const choosePeriod = (planId, period) => setPeriods((currentPeriods) => ({ ...currentPeriods, [planId]: period }));
  return (
    <section className="hz-section">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <h1 className="hz-heading">{tr("plansTitle")}</h1>
          <p className="hz-muted">{tr("plansSubtitle")}</p>
        </div>
        <div className="hz-card" style={{ padding: "10px 14px", color: "#F5C842", fontWeight: 900 }}>
          Current: {current}
        </div>
      </div>

      <div className="hz-card" style={{ padding: 18, marginTop: 20, display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <b style={{ color: "#F5C842" }}>Premium 7-day free trial</b>
          <div className="hz-muted">Try AI Tutor, Premium features, listening, reading, exercises, and quizzes.</div>
        </div>
        <button className="hz-gold-btn" disabled={trialUsed} onClick={onStartTrial}>{trialActive ? tr("trialActive") : trialUsed ? tr("trialUsed") : tr("startFreeTrial")}</button>
      </div>

      <div className="hz-grid" style={{ marginTop: 24, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
        {SUBSCRIPTION_PLANS.map((plan) => {
          const selectedPeriod = periods[plan.id];
          const period = PRICING_PERIODS[selectedPeriod];
          const active = current === `${plan.name} ${period.label}`;
          return (
            <article key={plan.id} className={`hz-card hz-plan-card ${plan.badge ? "featured" : ""}`}>
              {plan.badge && <div className="hz-plan-badge">{plan.badge}</div>}
              <h2 style={{ color: "#F5C842", margin: "0 0 8px", paddingRight: 120 }}>{plan.name} Plan</h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "14px 0" }}>
                {Object.values(PRICING_PERIODS).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`hz-tab ${selectedPeriod === item.id ? "active" : ""}`}
                    onClick={() => choosePeriod(plan.id, item.id)}
                    style={{ position: "relative" }}
                  >
                    {item.label}
                    {item.badge && <span style={{ display: "block", color: "#F5C842", fontSize: ".66rem", marginTop: 2 }}>{item.badge}</span>}
                  </button>
                ))}
              </div>
              <div className="hz-muted">{period.label} subscription</div>
              <div style={{ fontSize: "1.75rem", fontWeight: 900, marginTop: 10 }}>{period.price}</div>
              <ul className="hz-feature-list">
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              {plan.excluded?.length > 0 && (
                <div className="hz-muted" style={{ marginBottom: 16, fontSize: ".82rem" }}>
                  Does not include: {plan.excluded.join(", ")}.
                </div>
              )}
              <button
                className={plan.id === "premium" ? "hz-gold-btn" : "hz-tab"}
                style={{ marginTop: "auto", width: "100%" }}
                disabled={active}
                onClick={() => onChoosePlan(plan, selectedPeriod)}
              >
                {active ? `${tr("current")} ${tr("currentPlan")}` : `${tr("subscribe")} ${period.label}`}
              </button>
              {!user && <p className="hz-muted" style={{ fontSize: ".76rem", marginBottom: 0 }}>Create an account to activate this plan.</p>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PaymentPage({ plan, progress, onBack, onSuccess }) {
  const [method, setMethod] = useState(PAYMENT_METHODS[0]);
  const [details, setDetails] = useState({ name: "", card: "", expiry: "", cvc: "", email: "", account: "" });
  const [error, setError] = useState("");
  const update = (field) => (event) => setDetails((current) => ({ ...current, [field]: event.target.value }));

  const submit = (event) => {
    event.preventDefault();
    if (!plan) {
      setError("Choose a subscription plan first.");
      return;
    }
    if (method === "Credit/Debit Card" && (!details.name.trim() || !details.card.trim() || !details.expiry.trim() || !details.cvc.trim())) {
      setError("Please enter your card details.");
      return;
    }
    if (method === "PayPal" && !details.email.includes("@")) {
      setError("Please enter your PayPal email.");
      return;
    }
    if ((method === "Alipay" || method === "WeChat Pay") && !details.account.trim()) {
      setError(`Please enter your ${method} account.`);
      return;
    }
    setError("");
    onSuccess({ method, details });
  };

  if (!plan) {
    return (
      <section className="hz-section" style={{ maxWidth: 680 }}>
        <div className="hz-card" style={{ padding: 28 }}>
          <h1 className="hz-heading">Payment</h1>
          <p className="hz-muted">Choose a subscription plan before payment.</p>
          <button className="hz-gold-btn" onClick={onBack}>Back to Plans</button>
        </div>
      </section>
    );
  }
  const availableTokens = normalizeGamification(progress || {}).tokens;
  const discount = tokenDiscount(availableTokens);

  return (
    <section className="hz-section" style={{ maxWidth: 900 }}>
      <h1 className="hz-heading">Payment</h1>
      <p className="hz-muted">Subscribe to {plan.displayName}. This demo payment unlocks the selected plan in this browser.</p>
      <div className="hz-two-col">
        <div className="hz-card" style={{ padding: 24 }}>
          <h2 style={{ color: "#F5C842", marginTop: 0 }}>{plan.displayName}</h2>
          <div className="hz-muted">Duration: {plan.periodLabel}</div>
          <div style={{ fontSize: "1.6rem", fontWeight: 900, marginTop: 8 }}>{plan.price}</div>
          <div className="hz-card" style={{ padding: 12, marginTop: 12 }}>
            <b style={{ color: "var(--accent)" }}>Token discount: {discount}%</b>
            <div className="hz-muted">{availableTokens} tokens available. Token discounts are capped at 50%.</div>
          </div>
          <ul className="hz-feature-list">
            {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
          </ul>
          <button className="hz-tab" onClick={onBack}>Choose Different Plan</button>
        </div>

        <form className="hz-card" style={{ padding: 24 }} onSubmit={submit}>
          <h3 style={{ color: "#F5C842", marginTop: 0 }}>Payment Method</h3>
          <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
            {PAYMENT_METHODS.map((item) => (
              <button key={item} type="button" className={`hz-payment-method ${method === item ? "active" : ""}`} onClick={() => setMethod(item)}>{item}</button>
            ))}
          </div>

          {method === "Credit/Debit Card" ? (
            <div style={{ display: "grid", gap: 12 }}>
              <input className="hz-input" value={details.name} onChange={update("name")} placeholder="Name on card" />
              <input className="hz-input" value={details.card} onChange={update("card")} placeholder="Card number" inputMode="numeric" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <input className="hz-input" value={details.expiry} onChange={update("expiry")} placeholder="MM/YY" />
                <input className="hz-input" value={details.cvc} onChange={update("cvc")} placeholder="CVC" inputMode="numeric" />
              </div>
            </div>
          ) : method === "PayPal" ? (
            <input className="hz-input" value={details.email} onChange={update("email")} placeholder="PayPal email" />
          ) : (
            <input className="hz-input" value={details.account} onChange={update("account")} placeholder={`${method} account / phone`} />
          )}

          {error && <div className="hz-error" style={{ marginTop: 14 }}>{error}</div>}
          <button className="hz-gold-btn" style={{ width: "100%", marginTop: 18 }} type="submit">Pay and Activate {plan.displayName}</button>
        </form>
      </div>
    </section>
  );
}

function AuthCallbackPage() {
  return (
    <section className="hz-auth-wrap">
      <div className="hz-card" style={{ padding: 28, textAlign: "center", maxWidth: 520 }}>
        <h1 className="hz-heading">Verifying Email</h1>
        <p className="hz-muted">Finishing verification and returning you to login.</p>
      </div>
    </section>
  );
}

function AuthPage({ mode, setMode, onSuccess, notice = "" }) {
  const isSignup = mode === "signup";
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", dateOfBirth: "", agree: false });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setError("");
    setMessage(notice && !isSignup ? notice : "");
    setLoading(false);
    setForm({ name: "", email: "", password: "", confirm: "", dateOfBirth: "", agree: false });
  }, [mode, notice, isSignup]);

  const update = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!supabase) {
      if (import.meta.env.DEV) setError("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your Vite .env file.");
      return;
    }
    const email = normalizeEmail(form.email);
    const name = form.name.trim();
    const password = form.password;

    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    if (isSignup) {
      if (name.length < 2) {
        setError("Please enter your full name.");
        return;
      }
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      if (password !== form.confirm) {
        setError("Passwords do not match.");
        return;
      }
      if (!form.dateOfBirth) {
        setError("Date of birth is required.");
        return;
      }
      if (userAge(form.dateOfBirth) < 13) {
        setError("You must be at least 13 years old to create an account.");
        return;
      }
      if (!form.agree) {
        setError("You must agree to the Terms and Privacy Policy.");
        return;
      }
      if (await supabaseProfileEmailExists(email)) {
        setError("This email is already registered. Please log in instead.");
        return;
      }

      setLoading(true);
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            date_of_birth: form.dateOfBirth,
            terms_accepted: true,
            terms_accepted_at: new Date().toISOString(),
          },
          emailRedirectTo: window.location.origin,
        },
      });
      setLoading(false);

      if (signUpError) {
        setError(signUpError.message?.toLowerCase().includes("already") ? "This email is already registered. Please log in instead." : signUpError.message);
        return;
      }
      if (data.user?.identities && data.user.identities.length === 0) {
        setError("This email is already registered. Please log in instead.");
        return;
      }
      if (data.user) {
        const trialProgress = createInitialLearningState();
        const trialExpiresAt = dateAfterDays(7);
        trialProgress.subscription = {
          ...trialProgress.subscription,
          planType: "premium",
          planId: "premium",
          period: "trial",
          status: "trial",
          startedAt: new Date().toISOString(),
          expiresAt: trialExpiresAt,
          trialActive: true,
          trialUsed: true,
          paymentMethod: null,
          paymentHistory: [
            { planType: "premium", period: "trial", method: "Free Trial", date: new Date().toISOString(), expiresAt: trialExpiresAt },
          ],
        };
        saveLearningState(data.user.id, trialProgress);
        await saveSupabaseProfile(data.user, { fullName: name, email, dateOfBirth: form.dateOfBirth });
      }
      if (data.session?.user) {
        await supabase.auth.signOut();
      }
      setMessage("Account created. Please check your email to verify your account.");
      return;
    }

    if (password.length < 1) {
      setError("Please enter your password.");
      return;
    }

    setLoading(true);
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      const text = signInError.message || "";
      if (/email.*not.*confirm|confirm.*email|not verified/i.test(text)) setError("Please verify your email before logging in.");
      else if (/invalid login credentials/i.test(text)) setError((await supabaseProfileEmailExists(email)) ? "Incorrect password." : "No account found with this email.");
      else setError(text);
      return;
    }
    if (!data.user?.email_confirmed_at && !data.user?.confirmed_at) {
      await supabase.auth.signOut();
      setError("Please verify your email before logging in.");
      return;
    }
    await saveSupabaseProfile(data.user);
    onSuccess(createSupabaseSession(data.user), false);
  };

  return (
    <section className="hz-auth-wrap">
      <div className="hz-card hz-auth-card">
        <form className="hz-auth-panel" onSubmit={submit}>
          <h1 className="hz-heading" style={{ marginTop: 14 }}>{isSignup ? "Create Account" : "Welcome Back"}</h1>
          <p className="hz-muted" style={{ marginBottom: 22 }}>
            {isSignup ? "Save your study profile and start tracking HSK progress." : "Log in to continue your HanZi study session."}
          </p>

          {isSignup && (
            <label className="hz-form-row">
              <span className="hz-label">Full name</span>
              <input className="hz-input" value={form.name} onChange={update("name")} placeholder="Your name" autoComplete="name" />
            </label>
          )}
          <label className="hz-form-row">
            <span className="hz-label">Email</span>
            <input className="hz-input" type="email" value={form.email} onChange={update("email")} placeholder="you@example.com" autoComplete="email" />
          </label>
          <label className="hz-form-row">
            <span className="hz-label">Password</span>
            <input className="hz-input" type="password" value={form.password} onChange={update("password")} placeholder={isSignup ? "At least 6 characters" : "Your password"} autoComplete={isSignup ? "new-password" : "current-password"} />
          </label>
          {isSignup && (
            <>
              <label className="hz-form-row">
                <span className="hz-label">Confirm Password</span>
                <input className="hz-input" type="password" value={form.confirm} onChange={update("confirm")} placeholder="Repeat password" autoComplete="new-password" />
              </label>
              <label className="hz-form-row">
                <span className="hz-label">Date of birth</span>
                <input className="hz-input" type="date" value={form.dateOfBirth} onChange={update("dateOfBirth")} autoComplete="bday" />
              </label>
              <label className="hz-form-row" style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                <input type="checkbox" checked={form.agree} onChange={update("agree")} style={{ marginTop: 3 }} />
                <span className="hz-muted">I agree to the Terms and Privacy Policy.</span>
              </label>
            </>
          )}
          {error && <div className="hz-error" style={{ marginBottom: 14 }}>{error}</div>}
          {message && !error && <div className="hz-success" style={{ marginBottom: 14 }}>{message}</div>}

          <button className="hz-gold-btn" style={{ width: "100%", marginTop: 4 }} type="submit" disabled={loading}>{loading ? "Please wait..." : isSignup ? "Sign Up" : "Login"}</button>
          <button className="hz-plain-button" type="button" style={{ width: "100%", marginTop: 12 }} disabled={loading} onClick={() => setMode(isSignup ? "login" : "signup")}>
            {isSignup ? "Already have an account? Login" : "New here? Create an account"}
          </button>
          <p className="hz-muted" style={{ fontSize: ".78rem", marginTop: 16 }}>
            Authentication is handled by Supabase. New accounts must verify email before logging in.
          </p>
        </form>

        <aside className="hz-auth-side">
          <h2 style={{ color: "#F5C842", margin: "0 0 10px", fontFamily: "'Noto Serif SC',serif" }}>Your Chinese study profile</h2>
          <p className="hz-muted">Login unlocks a persistent local profile for saved sessions, dashboard identity, and future progress tracking.</p>
          <div style={{ display: "grid", gap: 10, marginTop: 24 }}>
            {["HSK vocabulary practice", "Grammar lesson history", "Reading and flashcard workflow"].map((item) => (
              <div key={item} className="hz-card" style={{ padding: 12, color: "rgba(237,232,220,.75)" }}>{item}</div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

function Onboarding({ user, progress, onComplete }) {
  const questions = [
    { id: "source", title: "Where did you hear about HanZi Tutor?", options: ["TikTok", "Instagram", "Friend", "YouTube", "Google", "School", "Other"] },
    { id: "level", title: "What is your current Chinese level?", options: ["Beginner", "HSK 1", "HSK 2", "HSK 3", "HSK 4"] },
    { id: "targetLevel", title: "What is your target HSK level?", options: ["HSK 1", "HSK 2", "HSK 3", "HSK 4"] },
    { id: "goal", title: "Why do you want to learn Chinese?", options: ["HSK Exam", "Study in China", "Communication", "Business", "Travel", "Personal Interest"] },
    { id: "hours", title: "How many hours per day do you want to study?", options: ["15 min", "30 min", "1 hour", "2 hours", "3+ hours"] },
    { id: "wordsPerDay", title: "How many words per day do you want to learn?", options: ["5", "10", "20", "30", "50"] },
    { id: "examDate", title: "When is your target exam?", options: ["1 month", "3 months", "6 months", "No date yet"] },
    { id: "skills", title: "Which skills do you want to improve most?", options: ["Vocabulary", "Grammar", "Listening", "Reading", "Speaking", "Writing"] },
  ];
  const [answers, setAnswers] = useState(progress?.preferences || {});
  const done = questions.every((question) => answers[question.id]);
  const choose = (id, value) => setAnswers((current) => ({ ...current, [id]: value }));
  const submit = () => {
    if (!done) return;
    onComplete({
      ...progress,
      onboardingComplete: true,
      preferences: answers,
      dailyChallenge: buildDailyChallenge(answers),
      gamification: createGamificationState(answers, progress),
    });
  };

  return (
    <section className="hz-section" style={{ maxWidth: 980 }}>
      <div className="hz-card" style={{ padding: 30 }}>
        <h1 className="hz-heading">Welcome to HanZi Tutor 👋</h1>
        <p className="hz-muted" style={{ marginBottom: 26 }}>Let's personalize your Chinese learning journey, {user?.name || "learner"}.</p>
        <div style={{ display: "grid", gap: 22 }}>
          {questions.map((question, index) => (
            <div key={question.id}>
              <h3 style={{ color: "#F5C842", margin: "0 0 10px" }}>{index + 1}. {question.title}</h3>
              <div className="hz-choice-grid">
                {question.options.map((option) => (
                  <button key={option} className={`hz-choice ${answers[question.id] === option ? "active" : ""}`} onClick={() => choose(question.id, option)}>{option}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button className="hz-gold-btn" disabled={!done} style={{ marginTop: 26, opacity: done ? 1 : 0.45 }} onClick={submit}>Start My Learning Plan</button>
      </div>
    </section>
  );
}

function SettingField({ label, children }) {
  return <label className="hz-setting-row"><span>{label}</span>{children}</label>;
}

function SettingToggle({ label, description, checked, onChange }) {
  return (
    <div className="hz-switch-row">
      <div>
        <div style={{ fontWeight: 900 }}>{label}</div>
        {description && <div className="hz-muted" style={{ fontSize: ".78rem" }}>{description}</div>}
      </div>
      <button type="button" className={`hz-switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)} aria-label={label}><span /></button>
    </div>
  );
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function preferredHskNumber(progress) {
  const raw = progress?.preferences?.targetLevel || progress?.preferences?.level || progress?.settings?.study?.preferredHsk || "HSK 1";
  const match = String(raw).match(/[1-5]/);
  return match ? Number(match[0]) : 1;
}

function buildAiRoadmap(progress) {
  const level = preferredHskNumber(progress);
  const target = Math.min(5, Math.max(level, Number(String(progress?.preferences?.targetLevel || "").match(/[1-5]/)?.[0] || level)));
  const dailyMinutes = Number(String(progress?.preferences?.hours || progress?.settings?.study?.dailyTime || "30").match(/\d+/)?.[0] || 30);
  const wordsPerDay = Number(progress?.preferences?.wordsPerDay || 10);
  const remaining = Math.max(0, HSK_TARGETS[target] - Number(progress?.wordsLearned || 0));
  const estimatedDays = Math.max(14, Math.ceil(remaining / Math.max(1, wordsPerDay)) + target * 10);
  return {
    level,
    target,
    estimatedDate: addDaysToKey(todayKey(), estimatedDays),
    daily: [`Learn ${wordsPerDay} words`, `Review ${Math.min(20, wordsPerDay * 2)} flashcards`, `${dailyMinutes} min listening/reading`, "Complete one grammar or speaking task"],
    weekly: [`Finish ${Math.max(3, target + 2)} grammar points`, `Complete ${target * 2} listening tasks`, "Review weak areas twice"],
    monthly: [`Reach ${Math.min(100, Math.round((progress?.wordsLearned || 0) / HSK_TARGETS[target] * 100) + 15)}% HSK ${target} vocabulary`, "Complete one strict exam simulation", "Generate one AI lesson from a real-life goal"],
  };
}

function detectWeakAreas(progress) {
  const weak = Object.entries(progress?.weakSkills || {}).map(([name, count]) => ({ name, count }));
  const defaults = ["把 sentences", "被 sentences", "Result complements", "Listening numbers", "Measure words"].map((name, index) => ({ name, count: Math.max(1, 5 - index) }));
  return [...weak, ...defaults].sort((a, b) => b.count - a.count).slice(0, 5);
}

function examPrediction(progress) {
  const level = preferredHskNumber(progress);
  const vocab = Math.min(1, (progress?.wordsLearned || 0) / HSK_TARGETS[level]);
  const grammar = Math.min(1, (progress?.grammarCompleted || 0) / Math.max(20, GRAMMAR_TARGET_COUNTS[level]));
  const reading = Math.min(1, (progress?.readingsCompleted || 0) / 20);
  const listening = Math.min(1, (progress?.listeningCompleted || 0) / 24);
  const readiness = Math.round((vocab * .35 + grammar * .2 + reading * .2 + listening * .25) * 100);
  return { level, readiness, score: Math.max(90, Math.round(readiness * 3)), pass: Math.min(99, Math.max(5, readiness + 8)) };
}

function achievementsFor(progress) {
  const checks = [
    ["First 100 words", (progress?.wordsLearned || 0) >= 100],
    ["First 500 words", (progress?.wordsLearned || 0) >= 500],
    ["HSK 1 completed", (progress?.hskProgress?.[1] || 0) >= HSK_TARGETS[1]],
    ["HSK 2 completed", (progress?.hskProgress?.[2] || 0) >= HSK_TARGETS[2]],
    ["HSK 3 completed", (progress?.hskProgress?.[3] || 0) >= HSK_TARGETS[3]],
    ["HSK 4 completed", (progress?.hskProgress?.[4] || 0) >= HSK_TARGETS[4]],
    ["HSK 5 completed", (progress?.hskProgress?.[5] || 0) >= HSK_TARGETS[5]],
    ["7-day streak", (progress?.streak || 0) >= 7],
    ["30-day streak", (progress?.streak || 0) >= 30],
    ["Listening Master", (progress?.listeningCompleted || 0) >= 50],
    ["Grammar Master", (progress?.grammarCompleted || 0) >= 80],
  ];
  return checks.map(([name, unlocked]) => ({ name, unlocked }));
}

function rpgAchievements(progress) {
  return [
    { id: "first-word", name: "First Word Learned", badge: "Word Spark", unlocked: (progress?.wordsLearned || 0) >= 1, rewardXp: 30, rewardTokens: 5 },
    { id: "words-100", name: "100 Words Learned", badge: "Vocabulary Scout", unlocked: (progress?.wordsLearned || 0) >= 100, rewardXp: 120, rewardTokens: 20 },
    { id: "words-500", name: "500 Words Learned", badge: "Lexicon Keeper", unlocked: (progress?.wordsLearned || 0) >= 500, rewardXp: 260, rewardTokens: 45 },
    { id: "hsk1", name: "HSK 1 Completed", badge: "Village Champion", unlocked: (progress?.hskProgress?.[1] || 0) >= HSK_TARGETS[1], rewardXp: 200, rewardTokens: 35 },
    { id: "hsk2", name: "HSK 2 Completed", badge: "Town Champion", unlocked: (progress?.hskProgress?.[2] || 0) >= HSK_TARGETS[2], rewardXp: 260, rewardTokens: 45 },
    { id: "hsk3", name: "HSK 3 Completed", badge: "City Champion", unlocked: (progress?.hskProgress?.[3] || 0) >= HSK_TARGETS[3], rewardXp: 320, rewardTokens: 55 },
    { id: "hsk4", name: "HSK 4 Completed", badge: "Academy Champion", unlocked: (progress?.hskProgress?.[4] || 0) >= HSK_TARGETS[4], rewardXp: 420, rewardTokens: 70 },
    { id: "hsk5", name: "HSK 5 Completed", badge: "Palace Scholar", unlocked: (progress?.hskProgress?.[5] || 0) >= HSK_TARGETS[5], rewardXp: 560, rewardTokens: 95 },
    { id: "streak-7", name: "7 Day Streak", badge: "Flame Keeper", unlocked: (progress?.streak || 0) >= 7, rewardXp: 150, rewardTokens: 25 },
    { id: "streak-30", name: "30 Day Streak", badge: "Discipline Master", unlocked: (progress?.streak || 0) >= 30, rewardXp: 400, rewardTokens: 75 },
    { id: "grammar-master", name: "Grammar Master", badge: "Pattern Sage", unlocked: (progress?.grammarCompleted || 0) >= 80, rewardXp: 300, rewardTokens: 55 },
    { id: "listening-champion", name: "Listening Champion", badge: "Sound Walker", unlocked: (progress?.listeningCompleted || 0) >= 50, rewardXp: 300, rewardTokens: 55 },
  ];
}

function skillTreeFor(progress) {
  const preferred = preferredHskNumber(progress);
  return {
    vocabulary: Math.min(100, Math.round(((progress?.wordsLearned || 0) / HSK_TARGETS[preferred]) * 100)),
    grammar: Math.min(100, Math.round(((progress?.grammarCompleted || 0) / Math.max(20, GRAMMAR_TARGET_COUNTS[preferred])) * 100)),
    reading: Math.min(100, Math.round(((progress?.readingsCompleted || 0) / 20) * 100)),
    listening: Math.min(100, Math.round(((progress?.listeningCompleted || 0) / 24) * 100)),
    speaking: Math.min(100, Math.round(((progress?.speakingCompleted || 0) / 20) * 100)),
    writing: Math.min(100, Math.round(((progress?.exercisesCompleted || 0) / 50) * 100)),
  };
}

function tokenDiscount(tokens = 0) {
  if (tokens >= 1000) return 30;
  if (tokens >= 500) return 20;
  if (tokens >= 250) return 10;
  if (tokens >= 100) return 5;
  return 0;
}

function generateAiNews(level) {
  const title = ["校园新计划", "城市交通变化", "中文学习活动", "青年职业发展"][level - 1] || "每日中文新闻";
  const text = professionalPassageForTopic(level, title, level + 3).text;
  return { title, text, translation: `Daily HSK ${level} news-style reading with controlled vocabulary.`, questions: ["这条新闻主要说什么？", "谁受到影响？", "最后有什么建议？"] };
}

function checkWriting(text, level) {
  const hasChineseText = hasChinese(text);
  const lengthScore = Math.min(35, text.length);
  const grammarScore = /因为|所以|虽然|但是|把|被|了|的/.test(text) ? 30 : 18;
  const naturalScore = hasChineseText ? 25 : 5;
  const score = Math.min(100, lengthScore + grammarScore + naturalScore);
  return {
    score,
    corrections: hasChineseText ? ["Check punctuation: use 。 between complete ideas.", "Add time words before the verb when possible."] : ["Write in Chinese characters first."],
    better: hasChineseText ? `${text.replace(/[.!?]/g, "。")} 我会继续练习，让句子更自然。` : `我想用中文表达自己的想法。`,
    explanation: `HSK ${level} writing feedback checks character use, sentence length, grammar markers, and natural word order.`,
  };
}

function characterExplore(char) {
  const word = allWords().find((item) => item.char?.includes(char));
  return {
    char,
    pinyin: word?.pinyin || "unknown",
    meaning: word?.meaning || "Use in words to confirm meaning.",
    components: char ? [char] : [],
    similar: allWords().filter((item) => item.char !== char && item.char?.includes(char)).slice(0, 5).map((item) => item.char),
    words: allWords().filter((item) => item.char?.includes(char)).slice(0, 6),
  };
}

function saveTutorMemory(note) {
  const messages = [...loadTutorConversation(), { role: "assistant", content: note, audioItems: [] }].slice(-20);
  writeStorage(TUTOR_CONVERSATION_KEY, messages);
}

function PremiumAiLab({ progress, onActivity, settings = createDefaultSettings() }) {
  const [topic, setTopic] = useState("Travel vocabulary");
  const [writing, setWriting] = useState("我今天想学习中文，因为中文很有意思。");
  const [character, setCharacter] = useState("学");
  const [speechResult, setSpeechResult] = useState(null);
  const [role, setRole] = useState("Chinese teacher");
  const level = preferredHskNumber(progress);
  const roadmap = buildAiRoadmap(progress);
  const weak = detectWeakAreas(progress);
  const prediction = examPrediction(progress);
  const news = generateAiNews(level);
  const writingFeedback = checkWriting(writing, level);
  const charInfo = characterExplore(character.trim()[0] || "学");
  const generatedCards = gradedWordsForLevel(level).filter((word) => `${word.meaning} ${word.tags?.join(" ")}`.toLowerCase().includes(topic.toLowerCase().split(" ")[0])).slice(0, 20);
  const storyWords = generatedCards.length ? generatedCards : gradedWordsForLevel(level).slice(0, 8);
  const speak = useChineseSpeech(settings);
  const startSpeaking = () => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setSpeechResult({ transcript: "Browser speech recognition is not available.", pronunciation: 0, tone: 0, fluency: 0, confidence: 0 });
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      const confidence = Math.round((event.results?.[0]?.[0]?.confidence || .7) * 100);
      const chineseRatio = hasChinese(transcript) ? 1 : .45;
      setSpeechResult({ transcript, pronunciation: Math.round(confidence * chineseRatio), tone: Math.max(45, confidence - 8), fluency: Math.min(98, transcript.length * 8), confidence });
      onActivity?.("speaking", { transcript, score: confidence });
    };
    recognition.start();
  };
  const activateAiTask = (label, type = "ai") => {
    saveTutorMemory(`AI Lab created: ${label}. Current weak areas: ${weak.map((item) => item.name).join(", ")}.`);
    onActivity?.(type, { label, level });
  };
  return (
    <section className="hz-section">
      <h1 className="hz-heading">HanZi AI Lab</h1>
      <p className="hz-muted">A premium AI-powered learning ecosystem connected to your HSK level, progress, weak areas, XP, and tutor memory.</p>
      <div className="hz-grid" style={{ marginTop: 18 }}>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>AI Study Roadmap</h3>{roadmap.daily.map((item) => <div key={item} className="hz-muted">Today: {item}</div>)}<div className="hz-muted" style={{ marginTop: 8 }}>Estimated HSK {roadmap.target} exam date: {roadmap.estimatedDate}</div><button className="hz-gold-btn" style={{ marginTop: 12 }} onClick={() => activateAiTask("roadmap daily plan")}>Start Daily Plan</button></div>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>Weakest Areas</h3>{weak.map((item) => <div key={item.name} className="hz-muted">{item.name}: {item.count} signals</div>)}<button className="hz-gold-btn" style={{ marginTop: 12 }} onClick={() => activateAiTask("weakness review session", "exercise")}>Generate Review</button></div>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>AI Exam Predictor</h3><b style={{ color: "var(--accent)", fontSize: "2rem" }}>{prediction.readiness}%</b><div className="hz-muted">HSK {prediction.level} readiness · predicted score {prediction.score}/300 · pass probability {prediction.pass}%</div><button className="hz-tab" style={{ marginTop: 12 }} onClick={() => activateAiTask("exam readiness review", "quiz")}>Create Exam Review</button></div>
      </div>
      <div className="hz-two-col" style={{ marginTop: 18 }}>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>Vocabulary Heatmap</h3><div style={{ display: "grid", gridTemplateColumns: "repeat(14,1fr)", gap: 4 }}>{Array.from({ length: 98 }, (_, i) => { const words = Object.values(progress?.learnedWords || {}); const word = words[i % Math.max(1, words.length)]; const colors = { New: "#3B82F6", Learning: "#F59E0B", Familiar: "#22C55E", Mastered: "#A855F7" }; return <div key={i} title={word?.chinese || "Review due"} style={{ aspectRatio: "1", borderRadius: 3, background: word ? colors[word.mastery] || "#3B82F6" : "rgba(255,255,255,.06)" }} />; })}</div><p className="hz-muted">Blue new · amber learning · green familiar · purple mastered.</p></div>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>Achievements</h3>{achievementsFor(progress).map((item) => <span key={item.name} className="hz-badge" style={{ margin: 4, color: item.unlocked ? "#70C997" : "var(--muted)", background: item.unlocked ? "rgba(76,175,125,.12)" : "rgba(255,255,255,.04)", border: "1px solid var(--border)" }}>{item.unlocked ? "Unlocked" : "Locked"} · {item.name}</span>)}</div>
      </div>
      <div className="hz-grid" style={{ marginTop: 18 }}>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>AI Speaking Coach</h3><button className="hz-gold-btn" onClick={startSpeaking}>Start Microphone</button>{speechResult && <div className="hz-muted" style={{ marginTop: 10 }}>Transcript: {speechResult.transcript}<br />Pronunciation: {speechResult.pronunciation}% · Tone Accuracy: {speechResult.tone}% · Fluency: {speechResult.fluency}% · Confidence: {speechResult.confidence}%</div>}</div>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>AI Roleplay</h3><select className="hz-input" value={role} onChange={(e) => setRole(e.target.value)}>{["Chinese teacher", "Friend", "Shopkeeper", "Waiter", "Taxi driver", "Hotel staff", "Business client", "Job interviewer"].map((item) => <option key={item}>{item}</option>)}</select><p className="hz-muted">Roleplay prompt: You are speaking with a {role}. Start with: 你好，我想练习中文。</p><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}><button className={speak.buttonClass("roleplay-demo")} onClick={() => speak("你好，我想练习中文。", settings.audio.voiceSpeed || 1, "roleplay-demo", { voice: ROLEPLAY_VOICES[role] || settings.audio.voiceType })}>{speak.label("roleplay-demo", "Play Audio")}</button><button className="hz-tab" onClick={() => activateAiTask(`${role} roleplay`)}>Save to Tutor Memory</button></div><div className="hz-muted" style={{ marginTop: 8 }}><span className="hz-speaker-dot" style={{ display: "inline-block", marginRight: 6 }} />Active speaker voice: {TTS_VOICE_OPTIONS.find((item) => item.value === (ROLEPLAY_VOICES[role] || settings.audio.voiceType))?.label || "Roleplay voice"}</div></div>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>Daily AI News</h3><b>{news.title}</b><p style={{ font: "1rem/1.8 'Noto Serif SC',serif" }}>{news.text}</p><button className={speak.buttonClass("ai-news-play")} onClick={() => speak(news.text, settings.audio.voiceSpeed || 0.85, "ai-news-play")}>{speak.label("ai-news-play")}</button><button className="hz-gold-btn" style={{ marginLeft: 8 }} onClick={() => activateAiTask("daily news", "reading")}>Complete News</button></div>
      </div>
      <div className="hz-two-col" style={{ marginTop: 18 }}>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>AI Writing Checker</h3><textarea className="hz-input" rows={5} value={writing} onChange={(e) => setWriting(e.target.value)} /><p className="hz-muted">Score: {writingFeedback.score}/100<br />Better version: {writingFeedback.better}<br />{writingFeedback.explanation}</p>{writingFeedback.corrections.map((item) => <div key={item} className="hz-muted">• {item}</div>)}<button className="hz-gold-btn" style={{ marginTop: 10 }} onClick={() => activateAiTask("writing correction", "exercise")}>Save Writing Review</button></div>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>Character Explorer</h3><input className="hz-input" value={character} onChange={(e) => setCharacter(e.target.value)} maxLength={2} /><div style={{ font: "700 3rem 'Noto Serif SC',serif", color: "var(--accent)" }}>{charInfo.char}</div><p className="hz-muted">{charInfo.pinyin} · {charInfo.meaning}<br />Similar/common words: {charInfo.words.map((item) => item.char).join(", ") || "Add more vocabulary by studying."}</p></div>
      </div>
      <div className="hz-grid" style={{ marginTop: 18 }}>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>AI Flashcard Generator</h3><input className="hz-input" value={topic} onChange={(e) => setTopic(e.target.value)} /><p className="hz-muted">{generatedCards.length || 20} cards generated from HSK {level} vocabulary.</p>{(generatedCards.length ? generatedCards : gradedWordsForLevel(level).slice(0, 20)).slice(0, 6).map((word) => <span key={word.char} className="hz-badge" style={{ margin: 3, color: "var(--accent)", border: "1px solid var(--border)" }}>{word.char} · {word.meaning}</span>)}<br /><button className="hz-gold-btn" style={{ marginTop: 10 }} onClick={() => activateAiTask(`${topic} flashcards`, "flashcard")}>Generate + Save</button></div>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>AI Story Generator</h3><p style={{ font: "1rem/1.8 'Noto Serif SC',serif" }}>今天我学习{storyWords.slice(0, 4).map((word) => word.char).join("、")}。老师说，只要每天练习，就会越来越好。晚上，我用这些词写了一个小故事。</p><button className="hz-tab" onClick={() => activateAiTask("vocabulary story", "reading")}>Save Story Practice</button></div>
        <div className="hz-card" style={{ padding: 20 }}><h3 style={{ color: "var(--accent)", marginTop: 0 }}>AI Lesson Generator</h3><p className="hz-muted">Lesson: Teach me how to order food in China.</p><div className="hz-muted">Vocabulary: 服务员, 菜单, 米饭, 茶, 多少钱<br />Grammar: 我想..., 请给我..., 因为...所以...<br />Dialogue, listening, reading, exercises, quiz, and speaking prompt are generated from the same topic.</div><button className="hz-gold-btn" style={{ marginTop: 10 }} onClick={() => activateAiTask("ordering food complete AI lesson", "grammar")}>Start AI Lesson</button></div>
      </div>
    </section>
  );
}

function SettingsPage({ user, progress, language = "English", onSaveProgress, onUpdateUser, onResetProgress, onCancelSubscription, onUpgrade, onLogout, onSignIn }) {
  const [active, setActive] = useState("profile");
  const [draft, setDraft] = useState(() => ({
    name: user?.name || "",
    email: user?.email || "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    settings: normalizeSettings(progress?.settings),
  }));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const storedUser = user;
  const settings = draft.settings;
  const daysRemaining = subscriptionDaysRemaining(progress);
  const joined = storedUser?.createdAt ? new Date(storedUser.createdAt).toLocaleDateString() : "Supabase profile";
  const currentHsk = progress?.preferences?.level || settings.study.preferredHsk;
  const accuracy = quizAccuracy(progress);
  const accentMap = { Gold: "#F5C842", Red: "#E53935", Blue: "#2196F3", Purple: "#9C6BFF" };
  const accent = accentMap[settings.appearance.accentColor] || "#F5C842";
  const tr = (key) => uiText(settings.language.appLanguage || language, key);

  useEffect(() => {
    setDraft({
      name: user?.name || "",
      email: user?.email || "",
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
      settings: normalizeSettings(progress?.settings),
    });
  }, [user?.id, user?.name, user?.email, progress?.settings]);

  if (!user) {
    return (
      <section className="hz-section" style={{ maxWidth: 720 }}>
        <div className="hz-card" style={{ padding: 28, textAlign: "center" }}>
          <h1 className="hz-heading">Settings</h1>
          <p className="hz-muted">Log in or create an account to manage profile, study, subscription, and security settings.</p>
          <button className="hz-gold-btn" onClick={onSignIn}>Login / Sign Up</button>
        </div>
      </section>
    );
  }

  const setRoot = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const setSetting = (section, field, value) => {
    const nextSettings = {
      ...draft.settings,
      [section]: { ...draft.settings[section], [field]: value },
    };
    setDraft((current) => ({ ...current, settings: nextSettings }));
    if (section === "appearance" || section === "language" || section === "audio") {
      const normalized = normalizeSettings(nextSettings);
      if (section === "audio" && field === "voiceType") {
        console.log("[HanZi TTS settings] selectedVoice", normalizeTtsVoice(value));
      }
      onSaveProgress({ ...progress, settings: normalized });
    }
  };

  const handleAvatar = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSetting("profile", "avatar", reader.result);
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setError("");
    setMessage("");
    const email = draft.email.trim().toLowerCase();
    const name = draft.name.trim() || user.name;
    if (!email.includes("@") || !email.includes(".")) {
      setError("Please enter a valid email address.");
      return;
    }
    if (draft.newPassword) {
      if (draft.newPassword.length < 6) {
        setError("New password must be at least 6 characters.");
        return;
      }
      if (draft.newPassword !== draft.confirmPassword) {
        setError("New password and confirmation do not match.");
        return;
      }
    }

    if (!supabase) {
      if (import.meta.env.DEV) setError("Supabase is not configured.");
      return;
    }
    const updatePayload = {
      email,
      data: {
        full_name: name,
        date_of_birth: user.dateOfBirth || null,
      },
    };
    if (draft.newPassword) updatePayload.password = draft.newPassword;
    const { data, error: authError } = await supabase.auth.updateUser(updatePayload);
    if (authError) {
      setError(authError.message);
      return;
    }
    if (data.user) await saveSupabaseProfile(data.user, { fullName: name, email, dateOfBirth: user.dateOfBirth });
    const session = data.user ? createSupabaseSession(data.user) : { ...user, name, fullName: name, email };
    onUpdateUser(session);

    const nextSettings = normalizeSettings(draft.settings);
    console.log("[HanZi TTS settings] saved selectedVoice", nextSettings.audio.voiceType);
    onSaveProgress({
      ...progress,
      settings: nextSettings,
      preferences: {
        ...(progress?.preferences || {}),
        level: nextSettings.study.preferredHsk,
        wordsPerDay: parseInt(nextSettings.study.dailyWords, 10) || 10,
        hours: nextSettings.study.dailyTime,
      },
    });
    setDraft((current) => ({ ...current, currentPassword: "", newPassword: "", confirmPassword: "" }));
    setMessage("Settings saved.");
  };

  const renderProfile = () => (
    <>
      <div className="hz-settings-grid">
        <div className="hz-card hz-settings-preview" style={{ padding: 18 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div className="hz-avatar-preview">{settings.profile.avatar ? <img src={settings.profile.avatar} alt="" /> : (draft.name || "你").slice(0, 1).toUpperCase()}</div>
            <div>
              <div style={{ fontWeight: 900, color: accent }}>{draft.name || "HanZi Learner"}</div>
              <div className="hz-muted">{settings.profile.country} · {settings.profile.nativeLanguage}</div>
            </div>
          </div>
        </div>
        <div className="hz-card" style={{ padding: 18 }}>
          <div className="hz-muted">{tr("currentHskLevel")}</div>
          <div style={{ color: "#F5C842", fontWeight: 900 }}>{currentHsk}</div>
          <div className="hz-muted" style={{ marginTop: 8 }}>{tr("joinDate")}: {joined}</div>
          <div className="hz-muted">{tr("currentSubscription")}: {subscriptionName(progress)}</div>
        </div>
      </div>
      <div className="hz-settings-grid" style={{ marginTop: 16 }}>
        <SettingField label={tr("profilePicture")}><input className="hz-input" type="file" accept="image/*" onChange={handleAvatar} /></SettingField>
        <SettingField label={tr("username")}><input className="hz-input" value={draft.name} onChange={(event) => setRoot("name", event.target.value)} /></SettingField>
        <SettingField label={tr("email")}><input className="hz-input" value={draft.email} onChange={(event) => setRoot("email", event.target.value)} /></SettingField>
        <SettingField label={tr("country")}><select className="hz-input" value={settings.profile.country} onChange={(event) => setSetting("profile", "country", event.target.value)}>{COUNTRIES.map((item) => <option key={item}>{item}</option>)}</select></SettingField>
        <SettingField label={tr("nativeLanguage")}><select className="hz-input" value={settings.profile.nativeLanguage} onChange={(event) => setSetting("profile", "nativeLanguage", event.target.value)}>{LANGUAGE_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></SettingField>
      </div>
    </>
  );

  const renderStudy = () => (
    <>
      <div className="hz-settings-grid">
        <SettingField label={tr("dailyStudyGoal")}><select className="hz-input" value={settings.study.dailyWords} onChange={(event) => setSetting("study", "dailyWords", event.target.value)}>{["5 words/day", "10 words/day", "20 words/day"].map((item) => <option key={item}>{item}</option>)}</select></SettingField>
        <SettingField label={tr("dailyStudyTime")}><select className="hz-input" value={settings.study.dailyTime} onChange={(event) => setSetting("study", "dailyTime", event.target.value)}>{["15 min", "30 min", "1 hour"].map((item) => <option key={item}>{item}</option>)}</select></SettingField>
        <SettingField label={tr("preferredHsk")}><select className="hz-input" value={settings.study.preferredHsk} onChange={(event) => setSetting("study", "preferredHsk", event.target.value)}>{HSK_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></SettingField>
        <SettingField label={tr("difficulty")}><select className="hz-input" value={settings.study.difficulty} onChange={(event) => setSetting("study", "difficulty", event.target.value)}>{["Easy", "Balanced", "Challenging", "Exam mode"].map((item) => <option key={item}>{item}</option>)}</select></SettingField>
      </div>
      <SettingToggle label="Auto-play pronunciation" checked={settings.study.autoPlayPronunciation} onChange={(value) => setSetting("study", "autoPlayPronunciation", value)} />
      <SettingToggle label="Show pinyin automatically" checked={settings.study.showPinyin} onChange={(value) => setSetting("study", "showPinyin", value)} />
      <SettingToggle label="Show English translations automatically" checked={settings.study.showTranslations} onChange={(value) => setSetting("study", "showTranslations", value)} />
      <SettingToggle label="Enable spaced repetition" checked={settings.study.spacedRepetition} onChange={(value) => setSetting("study", "spacedRepetition", value)} />
      <SettingToggle label="Enable daily reminders" checked={settings.study.dailyReminders} onChange={(value) => setSetting("study", "dailyReminders", value)} />
    </>
  );

  const renderAudio = () => (
    <>
      <div className="hz-settings-grid">
        <SettingField label="Playback speed"><select className="hz-input" value={settings.audio.voiceSpeed} onChange={(event) => setSetting("audio", "voiceSpeed", Number(event.target.value))}>{TTS_SPEED_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></SettingField>
        <SettingField label="Preferred voice"><select className="hz-input" value={normalizeTtsVoice(settings.audio.voiceType)} onChange={(event) => setSetting("audio", "voiceType", event.target.value)}>{TTS_VOICE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></SettingField>
        <SettingField label="Pronunciation mode"><select className="hz-input" value={settings.audio.pronunciationMode || "natural"} onChange={(event) => setSetting("audio", "pronunciationMode", event.target.value)}>{PRONUNCIATION_MODES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></SettingField>
        <SettingField label={`Volume: ${Math.round(settings.audio.volume * 100)}%`}><input type="range" min="0" max="1" step="0.05" value={settings.audio.volume} onChange={(event) => setSetting("audio", "volume", Number(event.target.value))} /></SettingField>
      </div>
      <SettingToggle label="Auto-read sentences" checked={settings.audio.autoReadSentences} onChange={(value) => setSetting("audio", "autoReadSentences", value)} />
      <SettingToggle label="Enable listening exercises" checked={settings.audio.listeningExercises} onChange={(value) => setSetting("audio", "listeningExercises", value)} />
      <div className="hz-card" style={{ padding: 14, marginTop: 12 }}><b>Speech settings:</b> Browser voice is active for now. Premium OpenAI TTS remains ready and will run when <code>VITE_USE_OPENAI_TTS=true</code>.</div>
    </>
  );

  const renderAi = () => (
    <>
      <div className="hz-settings-grid">
        <SettingField label="Answer style"><select className="hz-input" value={settings.aiTutor.answerStyle} onChange={(event) => setSetting("aiTutor", "answerStyle", event.target.value)}>{["Short answers", "Detailed answers"].map((item) => <option key={item}>{item}</option>)}</select></SettingField>
        <SettingField label="Explanation level"><select className="hz-input" value={settings.aiTutor.explanationLevel} onChange={(event) => setSetting("aiTutor", "explanationLevel", event.target.value)}>{["Beginner explanations", "Advanced explanations"].map((item) => <option key={item}>{item}</option>)}</select></SettingField>
      </div>
      <SettingToggle label="Conversation mode" checked={settings.aiTutor.conversationMode} onChange={(value) => setSetting("aiTutor", "conversationMode", value)} />
      <SettingToggle label="Strict Chinese-only mode" checked={settings.aiTutor.strictChineseOnly} onChange={(value) => setSetting("aiTutor", "strictChineseOnly", value)} />
      <SettingToggle label="English support" checked={settings.aiTutor.englishSupport} onChange={(value) => setSetting("aiTutor", "englishSupport", value)} />
    </>
  );

  const renderNotifications = () => (
    <>
      <SettingToggle label="Daily reminder notifications" checked={settings.notifications.dailyReminder} onChange={(value) => setSetting("notifications", "dailyReminder", value)} />
      <SettingToggle label="Streak reminders" checked={settings.notifications.streakReminder} onChange={(value) => setSetting("notifications", "streakReminder", value)} />
      <SettingToggle label="Quiz reminders" checked={settings.notifications.quizReminder} onChange={(value) => setSetting("notifications", "quizReminder", value)} />
      <SettingToggle label="Review reminders" checked={settings.notifications.reviewReminder} onChange={(value) => setSetting("notifications", "reviewReminder", value)} />
      <SettingToggle label="Email notifications" checked={settings.notifications.emailNotifications} onChange={(value) => setSetting("notifications", "emailNotifications", value)} />
    </>
  );

  const renderAppearance = () => (
    <>
      <div className="hz-card hz-settings-preview" style={{ padding: 18, borderColor: `${accent}66` }}>
        <div style={{ fontSize: settings.appearance.fontSize, color: accent, fontWeight: 900 }}>{settings.appearance.theme} preview</div>
        <div className={`hz-bubble ${settings.appearance.chatBubbleStyle === "Compact" ? "user" : ""}`} style={{ marginTop: 12, maxWidth: "100%", borderColor: `${accent}55` }}>Chat bubble style: {settings.appearance.chatBubbleStyle}</div>
      </div>
      <div className="hz-settings-grid" style={{ marginTop: 16 }}>
        <SettingField label={tr("theme")}><select className="hz-input" value={settings.appearance.theme} onChange={(event) => setSetting("appearance", "theme", event.target.value)}>{["Dark mode", "Light mode", "AMOLED dark"].map((item) => <option key={item}>{item}</option>)}</select></SettingField>
        <SettingField label={tr("accentColor")}><select className="hz-input" value={settings.appearance.accentColor} onChange={(event) => setSetting("appearance", "accentColor", event.target.value)}>{["Gold", "Red", "Blue", "Purple"].map((item) => <option key={item}>{item}</option>)}</select></SettingField>
        <SettingField label={`Font size: ${settings.appearance.fontSize}px`}><input type="range" min="13" max="22" value={settings.appearance.fontSize} onChange={(event) => setSetting("appearance", "fontSize", Number(event.target.value))} /></SettingField>
        <SettingField label="Chat bubble style"><select className="hz-input" value={settings.appearance.chatBubbleStyle} onChange={(event) => setSetting("appearance", "chatBubbleStyle", event.target.value)}>{["Rounded", "Compact", "Classic"].map((item) => <option key={item}>{item}</option>)}</select></SettingField>
      </div>
      <SettingToggle label="Compact mode" checked={settings.appearance.compactMode} onChange={(value) => setSetting("appearance", "compactMode", value)} />
    </>
  );

  const renderData = () => (
    <>
      <div className="hz-grid">
        {[
          ["XP earned", progress?.xp || 0],
          ["Total words learned", progress?.wordsLearned || 0],
          ["Flashcards reviewed", progress?.flashcardsReviewed || 0],
          ["Listening completed", progress?.listeningCompleted || 0],
          ["Reading completed", progress?.readingsCompleted || 0],
          ["Quiz accuracy", accuracy],
        ].map(([label, value]) => <div key={label} className="hz-card" style={{ padding: 16 }}><b style={{ color: "#F5C842", fontSize: "1.25rem" }}>{value}</b><div className="hz-muted">{label}</div></div>)}
      </div>
      <div className="hz-card hz-danger-zone" style={{ padding: 18, marginTop: 16 }}>
        <h3 style={{ marginTop: 0, color: "#FF8A87" }}>Progress controls</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="hz-red-btn" onClick={() => window.confirm("Reset learning progress? Subscription and settings will stay saved.") && onResetProgress()}>{tr("resetProgress")}</button>
          <button className="hz-tab" onClick={() => downloadJson("HanZi-study-data.json", { user, progress })}>{tr("exportStudyData")}</button>
          <button className="hz-tab" onClick={() => downloadJson("HanZi-progress-backup.json", { exportedAt: new Date().toISOString(), user, progress })}>{tr("backupProgress")}</button>
        </div>
      </div>
    </>
  );

  const renderSubscription = () => (
    <div className="hz-settings-grid">
      <div className="hz-card" style={{ padding: 18 }}>
        <div className="hz-muted">Current plan</div>
        <div style={{ color: "#F5C842", fontWeight: 900, fontSize: "1.2rem" }}>{subscriptionName(progress)}</div>
        <div className="hz-muted" style={{ marginTop: 8 }}>Renewal date: {progress?.subscription?.expiresAt ? new Date(progress.subscription.expiresAt).toLocaleDateString() : "No renewal"}</div>
        <div className="hz-muted">Days remaining: {daysRemaining ? `${daysRemaining} days` : "No active plan"}</div>
      </div>
      <div className="hz-card" style={{ padding: 18 }}>
        <h3 style={{ color: "#F5C842", marginTop: 0 }}>Manage subscription</h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="hz-gold-btn" onClick={onUpgrade}>Upgrade plan</button>
          <button className="hz-tab" onClick={() => window.confirm("Cancel subscription? Premium features will lock after cancellation.") && onCancelSubscription()}>Cancel subscription</button>
          <button className="hz-tab" onClick={onUpgrade}>Manage payment methods</button>
        </div>
      </div>
    </div>
  );

  const renderSecurity = () => (
    <>
      <div className="hz-settings-grid">
        <SettingField label="New password"><input className="hz-input" type="password" value={draft.newPassword} onChange={(event) => setRoot("newPassword", event.target.value)} /></SettingField>
        <SettingField label="Confirm new password"><input className="hz-input" type="password" value={draft.confirmPassword} onChange={(event) => setRoot("confirmPassword", event.target.value)} /></SettingField>
      </div>
      <p className="hz-muted">Password and email changes are handled by Supabase Auth.</p>
      <SettingToggle label="Two-factor authentication" checked={settings.security.twoFactor} onChange={(value) => setSetting("security", "twoFactor", value)} />
      <SettingToggle label="Login activity alerts" checked={settings.security.loginAlerts} onChange={(value) => setSetting("security", "loginAlerts", value)} />
      <SettingToggle label="Remember trusted devices" checked={settings.security.rememberDevices} onChange={(value) => setSetting("security", "rememberDevices", value)} />
      <div className="hz-card" style={{ padding: 16, marginTop: 12 }}>
        <b>Login activity</b>
        <div className="hz-muted">Current browser session · Local demo device</div>
        <b style={{ display: "block", marginTop: 12 }}>Device management</b>
        <div className="hz-muted">1 trusted browser profile saved locally.</div>
        <button className="hz-red-btn" style={{ marginTop: 14 }} onClick={onLogout}>Logout from all devices</button>
      </div>
    </>
  );

  const renderLanguage = () => (
    <SettingField label={tr("appLanguage")}><select className="hz-input" value={settings.language.appLanguage} onChange={(event) => setSetting("language", "appLanguage", event.target.value)}>{LANGUAGE_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></SettingField>
  );

  const renderSupport = () => (
    <div className="hz-grid">
      {["FAQ", "Contact support", "Report bug", "Suggest feature", "Discord / Community link"].map((item) => (
        <button key={item} className="hz-card hover" style={{ padding: 18, textAlign: "left", color: "inherit", cursor: "pointer" }}>
          <b style={{ color: "#F5C842" }}>{item}</b>
          <div className="hz-muted">Open {item.toLowerCase()} resources.</div>
        </button>
      ))}
    </div>
  );

  const renderAbout = () => (
    <div className="hz-settings-grid">
      <div className="hz-card" style={{ padding: 18 }}><b>App version</b><div className="hz-muted">HanZi AI {SETTINGS_VERSION}</div></div>
      <div className="hz-card" style={{ padding: 18 }}><b>Platform info</b><div className="hz-muted">React + Vite local learning platform</div></div>
      <div className="hz-card" style={{ padding: 18 }}><b>Terms of service</b><div className="hz-muted">Demo terms placeholder</div></div>
      <div className="hz-card" style={{ padding: 18 }}><b>Privacy policy</b><div className="hz-muted">Local browser storage demo policy</div></div>
    </div>
  );

  const panels = {
    profile: renderProfile,
    study: renderStudy,
    audio: renderAudio,
    ai: renderAi,
    notifications: renderNotifications,
    appearance: renderAppearance,
    data: renderData,
    subscription: renderSubscription,
    security: renderSecurity,
    language: renderLanguage,
    support: renderSupport,
    about: renderAbout,
  };
  const title = tr(active) || SETTINGS_CATEGORIES.find(([id]) => id === active)?.[1] || tr("settings");

  return (
    <section className="hz-section">
      <h1 className="hz-heading">{tr("settings")}</h1>
      <p className="hz-muted">{tr("settingsSubtitle")}</p>
      <div className="hz-settings-shell">
        <aside className="hz-card hz-settings-sidebar">
          {SETTINGS_CATEGORIES.map(([id, label]) => <button key={id} className={`hz-settings-nav ${active === id ? "active" : ""}`} onClick={() => setActive(id)}>{tr(id) || label}</button>)}
        </aside>
        <div>
          <div className="hz-card hz-settings-panel">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
              <div>
                <h2 style={{ color: "#F5C842", margin: 0 }}>{title}</h2>
                <div className="hz-muted">{tr("changesPreview")}</div>
              </div>
            </div>
            {error && <div className="hz-error" style={{ marginBottom: 14 }}>{error}</div>}
            {message && <div className="hz-card" style={{ marginBottom: 14, padding: 12, borderColor: "rgba(76,175,125,.35)", color: "#4CAF7D" }}>{message}</div>}
            {panels[active]?.()}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 22 }}>
              <button className="hz-gold-btn" onClick={save}>{tr("saveChanges")}</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function AdminDashboard({ user }) {
  const isAdmin = normalizeEmail(user?.email) === ADMIN_EMAIL;
  const [active, setActive] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({
    profiles: [],
    progressRows: [],
    transactions: [],
    subscriptions: [],
    tableErrors: {},
    source: "supabase",
    lastSyncedAt: null,
  });

  const parseState = (state) => {
    if (!state) return {};
    if (typeof state === "string") {
      try {
        return JSON.parse(state);
      } catch {
        return {};
      }
    }
    return state;
  };
  const tableMissing = (message = "") => /Could not find the table|schema cache|does not exist|relation .* does not exist/i.test(message);
  const localAdminSnapshot = () => {
    const stored = allUserData();
    const localProgressRows = Object.entries(stored).map(([id, state]) => {
      const game = normalizeGamification(state || {});
      return {
        user_id: id,
        state,
        xp: state?.xp || 0,
        tokens: game.tokens || 0,
        player_level: playerLevelFromXp(state?.xp || 0),
        rank: game.rank,
        updated_at: state?.lastStudyDate || state?.subscription?.startedAt || "",
        source: "browser-history",
      };
    });
    const localProfiles = localProgressRows.map((row) => {
      const state = parseState(row.state);
      const isCurrentUser = row.user_id === user?.id;
      return {
        id: row.user_id,
        full_name: isCurrentUser ? user?.name : state?.settings?.profile?.displayName || "Browser History User",
        email: isCurrentUser ? user?.email : state?.email || "",
        created_at: state?.firstStudyDate || state?.subscription?.startedAt || "",
        updated_at: row.updated_at,
        source: row.source,
      };
    });
    if (user?.id && !localProfiles.some((profile) => profile.id === user.id)) {
      const currentState = getLearningState(user.id);
      const game = normalizeGamification(currentState);
      localProfiles.unshift({
        id: user.id,
        full_name: user.name || user.fullName || user.email?.split("@")[0] || "Current User",
        email: user.email || "",
        created_at: user.createdAt || "",
        updated_at: new Date().toISOString(),
        source: "current-session",
      });
      localProgressRows.unshift({
        user_id: user.id,
        state: currentState,
        xp: currentState?.xp || 0,
        tokens: game.tokens || 0,
        player_level: playerLevelFromXp(currentState?.xp || 0),
        rank: game.rank,
        updated_at: new Date().toISOString(),
        source: "current-session",
      });
    }
    return { localProfiles, localProgressRows };
  };
  const mergeById = (primaryRows, fallbackRows, idForRow) => {
    const seen = new Set();
    return [...primaryRows, ...fallbackRows].filter((row) => {
      const id = idForRow(row);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };
  const fetchTable = async (table, limit = 500) => {
    const { data: rows, error: tableError } = await supabase.from(table).select("*").limit(limit);
    if (tableError) return { rows: [], error: tableError.message };
    return { rows: rows || [], error: "" };
  };

  const loadAdminData = async () => {
    if (!isAdmin) return;
    setLoading(true);
    const local = localAdminSnapshot();
    if (!supabase) {
      setData({
        profiles: local.localProfiles,
        progressRows: local.localProgressRows,
        transactions: [],
        subscriptions: [],
        tableErrors: { supabase: "Supabase is not configured." },
        source: "browser",
        lastSyncedAt: new Date().toISOString(),
      });
      setLoading(false);
      return;
    }
    const [profiles, progressRows, transactions, subscriptions] = await Promise.all([
      fetchTable("profiles", 1000),
      fetchTable("learning_progress", 1000),
      fetchTable("transactions", 1000),
      fetchTable("subscriptions", 1000),
    ]);
    const profilesMissing = tableMissing(profiles.error);
    const progressMissing = tableMissing(progressRows.error);
    setData({
      profiles: profilesMissing ? local.localProfiles : mergeById(profiles.rows, local.localProfiles, (row) => row.id),
      progressRows: progressMissing ? local.localProgressRows : mergeById(progressRows.rows, local.localProgressRows, (row) => row.user_id || row.id),
      transactions: transactions.rows,
      subscriptions: subscriptions.rows,
      tableErrors: {
        profiles: profiles.error,
        learning_progress: progressRows.error,
        transactions: transactions.error,
        subscriptions: subscriptions.error,
      },
      source: profilesMissing || progressMissing ? "mixed" : "supabase",
      lastSyncedAt: new Date().toISOString(),
    });
    setLoading(false);
  };

  useEffect(() => {
    loadAdminData();
  }, [isAdmin, user?.id]);

  useEffect(() => {
    if (!isAdmin || !supabase) return undefined;
    const tables = ["profiles", "learning_progress", "transactions", "subscriptions"];
    const channel = supabase.channel("HanZi-admin-dashboard");
    tables.forEach((table) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => loadAdminData());
    });
    channel.subscribe();
    const onStorage = (event) => {
      if (event.key === USER_DATA_KEY) loadAdminData();
    };
    const onFocus = () => loadAdminData();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, [isAdmin]);

  const users = useMemo(() => {
    const profileMap = new Map(data.profiles.map((profile) => [profile.id, profile]));
    const progressMap = new Map(data.progressRows.map((row) => [row.user_id || row.id, row]));
    const ids = new Set([...profileMap.keys()]);
    return [...ids].map((id) => {
      const profile = profileMap.get(id) || {};
      const progressRow = progressMap.get(id) || {};
      const state = parseState(progressRow.state);
      const game = normalizeGamification(state);
      const metadata = profile.user_metadata || profile.raw_user_meta_data || {};
      const email = profile.email || metadata.email || state.email || "";
      const emailName = email.includes("@") ? email.split("@")[0] : "";
      const displayName = profile.full_name || metadata.full_name || metadata.name || emailName || "Unknown User";
      return {
        id,
        name: displayName,
        email,
        source: profile.source || progressRow.source || "supabase",
        joined: profile.created_at || state.createdAt || "",
        updated: progressRow.updated_at || profile.updated_at || "",
        xp: Number(progressRow.xp ?? state.xp ?? 0),
        tokens: Number(progressRow.tokens ?? game.tokens ?? 0),
        level: Number(progressRow.player_level ?? playerLevelFromXp(state.xp || 0)),
        rank: progressRow.rank || game.rank || playerRank(1).name,
        subscription: subscriptionName(state),
        streak: Number(state.streak || 0),
        words: Number(state.wordsLearned || 0),
        exercises: Number(state.exercisesCompleted || 0),
        exams: Array.isArray(state.examHistory) ? state.examHistory.length : 0,
        state,
      };
    }).sort((a, b) => b.xp - a.xp);
  }, [data.profiles, data.progressRows]);

  const derivedTransactions = useMemo(() => {
    const fromProgress = users.flatMap((adminUser) => {
      const history = adminUser.state?.subscription?.paymentHistory || [];
      return history.map((item, index) => ({
        id: `${adminUser.id}-${index}`,
        user_id: adminUser.id,
        email: adminUser.email,
        plan: item.planType || item.planId || item.type || "subscription",
        period: item.period || "n/a",
        method: item.method || adminUser.state?.subscription?.paymentMethod || "n/a",
        price: item.price || "n/a",
        status: item.type === "cancellation" ? "cancelled" : "recorded",
        date: item.date || item.created_at || "",
      }));
    });
    return [...data.transactions, ...fromProgress].sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0));
  }, [data.transactions, users]);

  const stats = useMemo(() => {
    const totalXp = users.reduce((sum, item) => sum + item.xp, 0);
    const totalTokens = users.reduce((sum, item) => sum + item.tokens, 0);
    const activeSubscribers = users.filter((item) => item.subscription !== "Free").length;
    const totalExams = users.reduce((sum, item) => sum + item.exams, 0);
    const totalExercises = users.reduce((sum, item) => sum + item.exercises, 0);
    return { totalXp, totalTokens, activeSubscribers, totalExams, totalExercises };
  }, [users]);

  const tableErrors = Object.entries(data.tableErrors).filter(([, message]) => message && !tableMissing(message));
  const missingTables = Object.entries(data.tableErrors).filter(([, message]) => message && tableMissing(message)).map(([table]) => table);
  const formatDate = (value) => value ? new Date(value).toLocaleString() : "n/a";
  const adminSchemaSql = `create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text unique,
  date_of_birth date,
  updated_at timestamptz default now()
);

create table if not exists public.learning_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  xp integer not null default 0,
  tokens integer not null default 0,
  player_level integer not null default 1,
  rank text,
  updated_at timestamptz default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  plan text,
  period text,
  method text,
  price text,
  status text default 'recorded',
  created_at timestamptz default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  plan_id text,
  status text,
  started_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz default now()
);`;

  if (!user) {
    return (
      <section className="hz-section">
        <h1 className="hz-heading">Admin Dashboard</h1>
        <div className="hz-card" style={{ padding: 24 }}>Please sign in to continue.</div>
      </section>
    );
  }
  if (!isAdmin) {
    return (
      <section className="hz-section">
        <h1 className="hz-heading">Admin Dashboard</h1>
        <div className="hz-card" style={{ padding: 24 }}>
          <h3 style={{ color: "var(--danger)", marginTop: 0 }}>Access denied</h3>
          <p className="hz-muted">Only {ADMIN_EMAIL} can access this dashboard.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="hz-section">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <h1 className="hz-heading" style={{ marginBottom: 8 }}>Admin Dashboard</h1>
          <p className="hz-muted">Live admin overview for users, analytics, subscriptions, transactions, and learning progress.</p>
        </div>
        <button className="hz-gold-btn" onClick={loadAdminData} disabled={loading}>{loading ? "Refreshing..." : "Refresh Data"}</button>
      </div>

      {tableErrors.length > 0 && (
        <div className="hz-card" style={{ padding: 16, marginTop: 18, borderColor: "rgba(229,57,53,.35)" }}>
          <b style={{ color: "var(--danger)" }}>Database access warning</b>
          <p className="hz-muted" style={{ marginBottom: 8 }}>Check Supabase configuration or RLS read access for {ADMIN_EMAIL}.</p>
          {tableErrors.map(([table, message]) => <div key={table} className="hz-muted">{table}: {message}</div>)}
        </div>
      )}
      {missingTables.length > 0 && (
        <div className="hz-card" style={{ padding: 16, marginTop: 18 }}>
          <b style={{ color: "var(--accent)" }}>Supabase admin tables are not created yet.</b>
          <p className="hz-muted" style={{ marginBottom: 8 }}>Showing current session and browser historical progress now. Create these Supabase tables for full realtime cross-device users, past progress, transactions, and subscriptions: {missingTables.join(", ")}.</p>
        </div>
      )}
      <div className="hz-card" style={{ padding: 14, marginTop: 18, display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span className="hz-muted">Data source: {data.source === "supabase" ? "Supabase realtime database" : data.source === "mixed" ? "Supabase plus browser historical fallback" : "Current browser/session fallback"}</span>
        <span className="hz-muted">Realtime: {supabase ? "database changes + browser refresh" : "browser/session only"} · Last sync: {formatDate(data.lastSyncedAt)}</span>
      </div>

      <div className="hz-grid" style={{ marginTop: 18 }}>
        {[
          ["Users", users.length, "profiles + learning_progress"],
          ["Active Plans", stats.activeSubscribers, "trial or paid learners"],
          ["Total XP", stats.totalXp, "checked-answer progress"],
          ["Total Tokens", stats.totalTokens, "reward economy"],
          ["Exercises", stats.totalExercises, "submitted answers"],
          ["Transactions", derivedTransactions.length, "database + payment history"],
        ].map(([label, value, note]) => (
          <article key={label} className="hz-card" style={{ padding: 18 }}>
            <div className="hz-muted">{label}</div>
            <div style={{ color: "var(--accent)", fontSize: "2rem", fontWeight: 900 }}>{value}</div>
            <div className="hz-muted">{note}</div>
          </article>
        ))}
      </div>

      <div className="hz-toolbar" style={{ marginTop: 18 }}>
        {["dashboard", "users", "analytics", "transactions", "database"].map((tab) => (
          <button key={tab} className={`hz-tab ${active === tab ? "active" : ""}`} onClick={() => setActive(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>
        ))}
      </div>

      {active === "dashboard" && (
        <div className="hz-two-col" style={{ marginTop: 18 }}>
          <article className="hz-card" style={{ padding: 22 }}>
            <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Top Learners</h3>
            {users.slice(0, 8).map((item, index) => (
              <div key={item.id} style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr) auto auto", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <b>{index + 1}</b>
                <div><b>{item.name}</b><div className="hz-muted">{item.email || "No email saved"}</div></div>
                <div style={{ textAlign: "right" }}><b>{item.xp} XP</b><div className="hz-muted">Level {item.level}</div></div>
                <div style={{ textAlign: "right" }}><b>{item.subscription}</b><div className="hz-muted">Plan</div></div>
              </div>
            ))}
          </article>
          <article className="hz-card" style={{ padding: 22 }}>
            <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Platform Health</h3>
            <div className="hz-muted">Readable tables: {["profiles", "learning_progress", "transactions", "subscriptions"].filter((table) => !data.tableErrors[table]).join(", ") || "none yet"}</div>
            <div className="hz-rpg-bar" style={{ marginTop: 14 }}><span style={{ width: `${Math.min(100, users.length * 10)}%` }} /></div>
            <p className="hz-muted">Latest user update: {formatDate(users[0]?.updated)}</p>
            <p className="hz-muted">Exam attempts recorded: {stats.totalExams}</p>
            <p className="hz-muted">Subscription rows: {data.subscriptions.length}</p>
          </article>
        </div>
      )}

      {active === "users" && (
        <div className="hz-card" style={{ padding: 18, marginTop: 18, overflowX: "auto" }}>
          <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Users</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead><tr>{["Name", "Email", "Plan", "XP", "Tokens", "Level", "Streak", "Words", "Exercises", "Source", "Updated"].map((head) => <th key={head} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid var(--border)" }}>{head}</th>)}</tr></thead>
            <tbody>{users.map((item) => <tr key={item.id}>{[item.name, item.email || item.id, item.subscription, item.xp, item.tokens, item.level, item.streak, item.words, item.exercises, item.source, formatDate(item.updated)].map((value, index) => <td key={index} style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{value}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}

      {active === "analytics" && (
        <div className="hz-grid" style={{ marginTop: 18 }}>
          {[
            ["Average XP", users.length ? Math.round(stats.totalXp / users.length) : 0],
            ["Average Tokens", users.length ? Math.round(stats.totalTokens / users.length) : 0],
            ["Total Exams", stats.totalExams],
            ["Total Exercises", stats.totalExercises],
            ["Trial/Paid Ratio", users.length ? `${Math.round((stats.activeSubscribers / users.length) * 100)}%` : "0%"],
            ["Readable Progress Rows", data.progressRows.length],
          ].map(([label, value]) => <article key={label} className="hz-card" style={{ padding: 20 }}><div className="hz-muted">{label}</div><h2 style={{ color: "var(--accent)", margin: "8px 0 0" }}>{value}</h2></article>)}
        </div>
      )}

      {active === "transactions" && (
        <div className="hz-card" style={{ padding: 18, marginTop: 18, overflowX: "auto" }}>
          <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Transactions</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
            <thead><tr>{["User", "Plan", "Period", "Method", "Price", "Status", "Date"].map((head) => <th key={head} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid var(--border)" }}>{head}</th>)}</tr></thead>
            <tbody>{derivedTransactions.map((item) => <tr key={item.id || `${item.user_id}-${item.date}`}>{[item.email || item.user_id || "n/a", item.plan || item.plan_id || "n/a", item.period || "n/a", item.method || item.payment_method || "n/a", item.price || item.amount || "n/a", item.status || "recorded", formatDate(item.created_at || item.date)].map((value, index) => <td key={index} style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>{value}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}

      {active === "database" && (
        <>
          <article className="hz-card" style={{ padding: 18, marginTop: 18 }}>
            <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Supabase schema setup</h3>
            <p className="hz-muted">Run this once in Supabase SQL Editor to store real users, historical progress, transactions, and subscriptions across devices.</p>
            <pre style={{ marginTop: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 360, overflow: "auto", background: "var(--input-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>{adminSchemaSql}</pre>
          </article>
          <div className="hz-two-col" style={{ marginTop: 18 }}>
            {[
              ["profiles", data.profiles],
              ["learning_progress", data.progressRows],
              ["transactions", data.transactions],
              ["subscriptions", data.subscriptions],
            ].map(([table, rows]) => (
              <article key={table} className="hz-card" style={{ padding: 18 }}>
                <h3 style={{ color: "var(--accent)", marginTop: 0 }}>{table}</h3>
                <div className="hz-muted">{rows.length} rows loaded</div>
                <pre style={{ marginTop: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 260, overflow: "auto", background: "var(--input-bg)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>{JSON.stringify(rows.slice(0, 3), null, 2)}</pre>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Dashboard({ user, progress, language = "English", onUpgrade }) {
  const state = normalizeWeeklyState(progress ? (globalThis.structuredClone ? globalThis.structuredClone(progress) : JSON.parse(JSON.stringify(progress))) : createInitialLearningState());
  state.gamification = normalizeGamification(state);
  const counts = LEVELS.map((level) => ({ level, total: HSK_TARGETS[level], done: state.hskProgress?.[level] || 0 }));
  const reviewDue = Object.values(state.learnedWords || {}).filter((word) => word.nextReview && new Date(word.nextReview) <= new Date()).length;
  const currentLevel = state.preferences?.level || "Beginner";
  const daysRemaining = subscriptionDaysRemaining(state);
  const currentWeekDate = todayKey();
  const currentWeekDay = state.weeklyStats.find((day) => day.date === currentWeekDate)?.day;
  const maxWeeklyXp = Math.max(1, ...state.weeklyStats.map((day) => Number(day.xp || 0)));
  const playerLevel = playerLevelFromXp(state.xp);
  const rank = playerRank(playerLevel);
  const currentLevelXp = xpForLevel(playerLevel);
  const nextLevelXp = xpForLevel(Math.min(100, playerLevel + 1));
  const levelProgress = Math.round(((state.xp - currentLevelXp) / Math.max(1, nextLevelXp - currentLevelXp)) * 100);
  const game = state.gamification;
  const activeMission = game.learningPath.find((mission) => mission.status === "active") || game.learningPath.find((mission) => mission.status !== "completed") || game.learningPath[0];
  const completedMissions = game.learningPath.filter((mission) => mission.status === "completed").length;
  const mapIndex = Math.min(RPG_LOCATIONS.length - 1, Math.floor(completedMissions / 3));
  const skills = skillTreeFor(state);
  const discount = tokenDiscount(game.tokens);
  const leaderboard = [
    { name: user?.name || "You", xp: state.xp, tokens: game.tokens, streak: state.streak, current: true },
    { name: "Ling Chen", xp: Math.max(0, state.xp + 480), tokens: game.tokens + 95, streak: Math.max(1, state.streak + 3) },
    { name: "Maya HSK", xp: Math.max(0, state.xp + 220), tokens: game.tokens + 42, streak: Math.max(1, state.streak + 1) },
    { name: "Alex Mandarin", xp: Math.max(0, state.xp - 130), tokens: Math.max(0, game.tokens - 24), streak: Math.max(0, state.streak - 2) },
  ].sort((a, b) => b.xp - a.xp);
  const tr = (key) => uiText(language, key);
  const cards = [
    ["Days Remaining", daysRemaining ? `${daysRemaining} days` : "No active plan", "⏳", "#FF9800"],
    ["Subscription", subscriptionName(state), "★", "#F5C842"],
    ["Current Level", currentLevel, "🎯", "#F5C842"],
    ["XP", state.xp, "⚡", "#F5C842"],
    ["Daily Streak", `${state.streak} days`, "🔥", "#E53935"],
    ["Words Learned", state.wordsLearned, "📚", "#4CAF7D"],
    ["Review Due Today", reviewDue, "🃏", "#2196F3"],
    ["Study Time Today", `${state.studyMinutesToday} min`, "⏱", "#FF9800"],
    ["Listening", state.listeningCompleted, "🎧", "#2196F3"],
    ["Reading", state.readingsCompleted, "📖", "#4CAF7D"],
    ["Grammar", state.grammarCompleted, "语", "#F5C842"],
    ["Exercises", state.exercisesCompleted, "✍", "#E53935"],
    ["Quizzes", state.quizzesCompleted, "?", "#FF9800"],
    ["Flashcards", state.flashcardsReviewed, "卡", "#2196F3"],
    ["Exams Completed", state.examHistory?.length || 0, "考", "#E53935"],
  ];
  return (
    <section className="hz-section">
      <h1 className="hz-heading">{tr("dashboard")}</h1>
      <p className="hz-muted">{user ? `Welcome back, ${user.name}. Everything starts from your saved progress.` : "A quick overview of the HSK 1-4 learning set."}</p>
      <div className="hz-card" style={{ padding: 18, marginTop: 18, display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "var(--accent)", fontWeight: 900 }}>{tr("currentPlan")}: {subscriptionName(state)}</div>
          <div className="hz-muted">{tr("daysRemaining")}: {daysRemaining ? `${daysRemaining} days` : tr("noActivePlan")}</div>
        </div>
        <button className="hz-gold-btn" onClick={onUpgrade}>{tr("upgradePlan")}</button>
      </div>
      <div className="hz-rpg-hero">
        <div>
          <div className="hz-muted">Player Profile</div>
          <h2 style={{ margin: "6px 0", color: "var(--accent)", fontSize: "2.2rem" }}>Level {playerLevel}</h2>
          <div style={{ fontWeight: 900 }}>{rank.icon} {rank.name}</div>
          <div className="hz-muted">XP: {state.xp} / {nextLevelXp}</div>
          <div className="hz-rpg-bar"><span style={{ width: `${Math.min(100, levelProgress)}%` }} /></div>
        </div>
        <div className="hz-rpg-stat"><b>{game.tokens}</b><span>Tokens</span></div>
        <div className="hz-rpg-stat"><b>{state.streak}</b><span>Day Streak</span></div>
        <div className="hz-rpg-stat"><b>{discount}%</b><span>Shop Discount</span></div>
        <div className="hz-rpg-stat"><b>{completedMissions}/{game.learningPath.length}</b><span>Missions</span></div>
      </div>
      {game.lastReward && (
        <div className="hz-rpg-toast">Quest reward: {game.lastReward.label} · +{game.lastReward.xp} XP · +{game.lastReward.tokens} Tokens</div>
      )}
      <div className="hz-two-col" style={{ marginTop: 18 }}>
        <div className="hz-card" style={{ padding: 22 }}>
          <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Learning Path Map</h3>
          <div className="hz-map-path">
            {RPG_LOCATIONS.map((location, index) => (
              <div key={location} className={`hz-map-node ${index < mapIndex ? "done" : index === mapIndex ? "active" : ""}`}>
                <span>{["村", "镇", "城", "院", "宫", "龙"][index]}</span>
                <b>{location}</b>
              </div>
            ))}
          </div>
          <div className="hz-card" style={{ padding: 16, marginTop: 18 }}>
            <div className="hz-muted">Active Mission</div>
            <h3 style={{ margin: "6px 0", color: "var(--accent)" }}>Mission {activeMission?.number}: {activeMission?.title}</h3>
            <div className="hz-muted">Location: {activeMission?.location} · Focus: {activeMission?.focus} · HSK {activeMission?.hskLevel}</div>
            <div style={{ marginTop: 10, fontWeight: 900 }}>Clears only from checked exercise, quiz, exam, or AI Tutor answers.</div>
          </div>
        </div>
        <div className="hz-card" style={{ padding: 22 }}>
          <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Daily Quests</h3>
          {(state.dailyChallenge?.tasks || []).slice(0, 3).map((quest) => {
            const pct = Math.min(100, Math.round((quest.value / quest.target) * 100));
            return <div key={quest.id} style={{ marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><b>{quest.label}</b><span className="hz-muted">Answer-only progress</span></div><div className="hz-rpg-bar small"><span style={{ width: `${pct}%` }} /></div><div className="hz-muted">{quest.value}/{quest.target}</div></div>;
          })}
          <h3 style={{ color: "var(--accent)", marginTop: 18 }}>Weekly Quests</h3>
          {(game.weeklyQuests || []).map((quest) => {
            const pct = Math.min(100, Math.round((quest.value / quest.target) * 100));
            return <div key={quest.id} style={{ marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><b>{quest.label}</b><span className="hz-muted">Answer-only progress</span></div><div className="hz-rpg-bar small"><span style={{ width: `${pct}%` }} /></div><div className="hz-muted">{quest.value}/{quest.target}{quest.completed ? " · Completed" : ""}</div></div>;
          })}
        </div>
      </div>
      <div className="hz-two-col" style={{ marginTop: 18 }}>
        <div className="hz-card" style={{ padding: 22 }}>
          <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Skill Tree</h3>
          {Object.entries(skills).map(([skill, pct]) => <div key={skill} style={{ marginBottom: 13 }}><div style={{ display: "flex", justifyContent: "space-between", textTransform: "capitalize" }}><b>{skill}</b><span className="hz-muted">{pct}%</span></div><div className="hz-rpg-bar small"><span style={{ width: `${pct}%` }} /></div></div>)}
        </div>
        <div className="hz-card" style={{ padding: 22 }}>
          <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Token Shop</h3>
          <p className="hz-muted">100 Tokens = 5%, 250 = 10%, 500 = 20%, 1000 = 30%. Maximum discount: 50%.</p>
          <div style={{ display: "grid", gap: 8 }}>
            {TOKEN_SHOP_ITEMS.slice(0, 5).map((item) => <div key={item.id} className="hz-shop-item"><div><b>{item.name}</b><div className="hz-muted">{item.detail}</div></div><span>{item.cost} Tokens</span></div>)}
          </div>
        </div>
      </div>
      <div className="hz-two-col" style={{ marginTop: 18 }}>
        <div className="hz-card" style={{ padding: 22 }}>
          <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Achievements</h3>
          {rpgAchievements(state).map((achievement) => {
            const saved = game.achievements?.[achievement.id];
            return <span key={achievement.id} className="hz-badge" style={{ margin: 4, color: saved ? "#70C997" : "var(--muted)", background: saved ? "rgba(76,175,125,.12)" : "rgba(255,255,255,.04)", border: "1px solid var(--border)" }}>{saved ? "Unlocked" : "Locked"} · {achievement.badge}</span>;
          })}
        </div>
        <div className="hz-card" style={{ padding: 22 }}>
          <h3 style={{ color: "var(--accent)", marginTop: 0 }}>Leaderboard</h3>
          {leaderboard.map((row, index) => <div key={row.name} className="hz-shop-item" style={{ borderColor: row.current ? "rgba(245,200,66,.45)" : "var(--border)" }}><div><b>{index + 1}. {row.name}</b><div className="hz-muted">{row.streak} day streak · {row.tokens} tokens</div></div><span>{row.xp} XP</span></div>)}
        </div>
      </div>
      <div className="hz-grid" style={{ marginTop: 22 }}>
        {cards.map(([label, value, icon, color]) => <div key={label} className="hz-card" style={{ padding: 20 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.5rem" }}><span>{icon}</span><b style={{ color }}>{value}</b></div><div className="hz-muted">{label}</div></div>)}
      </div>
      <div className="hz-two-col" style={{ marginTop: 18 }}>
        <div className="hz-card" style={{ padding: 22 }}>
          <h3 style={{ color: "var(--accent)", marginTop: 0 }}>{tr("hskProgress")}</h3>
          {counts.map((item) => {
            const pct = Math.round((item.done / item.total) * 100);
            return <div key={item.level} style={{ marginBottom: 16 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 7 }}><span><LevelBadge level={item.level} /> <span className="hz-muted">{item.done}/{item.total} words</span></span><span className="hz-muted">{pct}%</span></div><div style={{ height: 8, background: "rgba(255,255,255,.06)", borderRadius: 8 }}><div style={{ width: `${pct}%`, height: "100%", borderRadius: 8, background: "linear-gradient(90deg,var(--accent),var(--danger))" }} /></div></div>;
          })}
        </div>
        <div className="hz-card" style={{ padding: 22 }}>
          <h3 style={{ color: "var(--accent)", marginTop: 0 }}>{tr("dailyChallenge")}</h3>
          <p style={{ fontWeight: 800 }}>{state.dailyChallenge?.title}</p>
          {(state.dailyChallenge?.tasks || []).map((task) => {
            const pct = Math.min(100, Math.round((task.value / task.target) * 100));
            return <div key={task.id} style={{ marginBottom: 12 }}><div className="hz-muted">{tr(`task_${task.id}`) || task.label}: {task.value}/{task.target}</div><div style={{ height: 7, background: "rgba(255,255,255,.06)", borderRadius: 8 }}><div style={{ width: `${pct}%`, height: "100%", borderRadius: 8, background: "linear-gradient(90deg,var(--danger),var(--accent))" }} /></div></div>;
          })}
          <p className="hz-muted">{state.dailyChallenge?.completed ? "Great job! 🎉 Daily challenge completed." : "Keep your streak alive 🔥"}</p>
        </div>
      </div>
      <div className="hz-card" style={{ padding: 22, marginTop: 18 }}>
        <h3 style={{ color: "var(--accent)", marginTop: 0 }}>{tr("weeklyStatistics")}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8 }}>
          {(state.weeklyStats || []).map((day) => {
            const isCurrent = day.day === currentWeekDay;
            const barHeight = Math.round((Number(day.xp || 0) / maxWeeklyXp) * 80);
            return (
              <div key={day.day} style={{
                textAlign: "center",
                border: isCurrent ? "1px solid rgba(245,200,66,.34)" : "1px solid transparent",
                borderRadius: 10,
                padding: "8px 4px",
                boxShadow: isCurrent ? "0 0 18px rgba(245,200,66,.16)" : "none",
                background: isCurrent ? "rgba(245,200,66,.06)" : "transparent",
              }}>
                <div className="hz-muted">{tr("day")} {day.day}</div>
                <div style={{ height: 80, display: "flex", alignItems: "end", justifyContent: "center" }}>
                  <div style={{ width: 18, height: `${barHeight}px`, background: day.xp ? "linear-gradient(var(--accent),var(--danger))" : "rgba(255,255,255,.08)", borderRadius: 6 }} />
                </div>
                <div className="hz-muted" style={{ fontSize: ".75rem" }}>{day.xp} {tr("xp")}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function HanZiApp() {
  const [page, setPage] = useState("home");
  const [authMode, setAuthMode] = useState("login");
  const [authNotice, setAuthNotice] = useState("");
  const [user, setUser] = useState(null);
  const [progress, setProgress] = useState(() => createInitialLearningState());
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [selectedVocabLevel, setSelectedVocabLevel] = useState(1);
  const authCallbackRef = useRef(false);
  const openAuth = (mode) => {
    setAuthNotice("");
    setAuthMode(mode);
    setPage("auth");
  };
  const goPage = (nextPage) => {
    if (!user && PROTECTED_PAGES.has(nextPage)) {
      setAuthMode("login");
      setAuthNotice("Please sign in to continue learning.");
      setPage("auth");
      return;
    }
    if (nextPage === "admin" && normalizeEmail(user?.email) !== ADMIN_EMAIL) {
      setPage("dashboard");
      return;
    }
    setPage(nextPage);
  };
  const openVocabularyLevel = (level) => {
    const nextLevel = LEVELS.includes(Number(level)) ? Number(level) : 1;
    setSelectedVocabLevel(nextLevel);
    goPage("vocab");
  };
  useEffect(() => {
    const routedPage = pageFromCurrentPath();
    if (!routedPage) return;
    if (routedPage === "login" || routedPage === "signup") {
      openAuth(routedPage);
      return;
    }
    goPage(routedPage);
  }, []);
  useEffect(() => {
    if (!user && PROTECTED_PAGES.has(page)) {
      setAuthMode("login");
      setAuthNotice("Please sign in to continue learning.");
      setPage("auth");
    }
    if (user && page === "admin" && normalizeEmail(user.email) !== ADMIN_EMAIL) {
      setPage("dashboard");
    }
  }, [page, user]);
  const updateProgress = (next) => {
    setProgress(next);
    if (user?.id) saveLearningState(user.id, next);
  };
  const startFreeTrial = () => {
    if (!user?.id) {
      setAuthMode("signup");
      setPage("auth");
      return;
    }
    const current = getLearningState(user.id);
    if (current.subscription?.trialUsed) {
      setPage("pricing");
      return;
    }
    const next = {
      ...current,
      subscription: {
        ...current.subscription,
        planType: "premium",
        planId: "premium",
        period: "trial",
        status: "trial",
        startedAt: new Date().toISOString(),
        expiresAt: dateAfterDays(7),
        trialActive: true,
        trialUsed: true,
        paymentMethod: null,
        paymentHistory: [
          ...(current.subscription?.paymentHistory || []),
          { planType: "premium", period: "trial", method: "Free Trial", date: new Date().toISOString(), expiresAt: dateAfterDays(7) },
        ],
      },
    };
    updateProgress(next);
    setPage("pricing");
  };
  const choosePlan = (plan, periodId = "monthly") => {
    if (!user?.id) {
      setSelectedPlan({ ...plan, period: periodId });
      setAuthMode("signup");
      setPage("auth");
      return;
    }
    const period = PRICING_PERIODS[periodId] || PRICING_PERIODS.monthly;
    setSelectedPlan({
      ...plan,
      planType: plan.id,
      period: period.id,
      periodLabel: period.label,
      durationDays: period.days,
      price: period.price,
      displayName: `${plan.name} ${period.label}`,
    });
    setPage("payment");
  };
  const completePayment = ({ method }) => {
    if (!user?.id || !selectedPlan) return;
    const current = getLearningState(user.id);
    const currentGame = normalizeGamification(current);
    const discount = tokenDiscount(currentGame.tokens);
    const discountCost = discount >= 30 ? 1000 : discount >= 20 ? 500 : discount >= 10 ? 250 : discount >= 5 ? 100 : 0;
    const expiresAt = dateAfterDays(selectedPlan.durationDays || 30);
    const next = {
      ...current,
      gamification: {
        ...currentGame,
        tokens: Math.max(0, currentGame.tokens - discountCost),
        shopPurchases: [
          ...(currentGame.shopPurchases || []),
          ...(discount ? [{ id: `subscription-discount-${discount}`, name: `${discount}% subscription discount`, cost: discountCost, date: new Date().toISOString() }] : []),
        ],
      },
      subscription: {
        ...(current.subscription || {}),
        planType: selectedPlan.planType,
        planId: selectedPlan.planType,
        period: selectedPlan.period,
        status: "active",
        startedAt: new Date().toISOString(),
        expiresAt,
        trialActive: false,
        trialUsed: current.subscription?.trialUsed || false,
        paymentMethod: method,
        paymentHistory: [
          ...(current.subscription?.paymentHistory || []),
          {
            planType: selectedPlan.planType,
            period: selectedPlan.period,
            method,
            price: selectedPlan.price,
            tokenDiscount: discount,
            tokensSpent: discountCost,
            date: new Date().toISOString(),
            expiresAt,
          },
        ],
      },
    };
    updateProgress(next);
    setPage("dashboard");
  };
  const handleAuthSuccess = (session, isNew = false) => {
    let nextProgress = getLearningState(session.id);
    if (isNew && !allUserData()[session.id]) {
      nextProgress = createInitialLearningState();
      saveLearningState(session.id, nextProgress);
    }
    setUser(session);
    setProgress(nextProgress);
    setPage("home");
  };
  useEffect(() => {
    if (!supabase) return undefined;
    let mounted = true;
    const handleVerificationCallback = async () => {
      authCallbackRef.current = true;
      setPage("auth-callback");
      const callbackCode = new URLSearchParams(window.location.search).get("code");
      if (callbackCode) {
        await supabase.auth.exchangeCodeForSession(callbackCode);
      } else {
        await supabase.auth.getSession();
      }
      await supabase.auth.signOut();
      if (!mounted) return;
      writeStorage(AUTH_SESSION_KEY, null);
      writeStorage(LEGACY_AUTH_SESSION_KEY, null);
      setUser(null);
      setProgress(createInitialLearningState());
      setAuthMode("login");
      setAuthNotice("Email verified successfully. Please log in to continue.");
      clearAuthCallbackUrl();
      setPage("auth");
      window.setTimeout(() => {
        authCallbackRef.current = false;
      }, 0);
    };
    if (isSupabaseAuthCallback()) {
      handleVerificationCallback();
    } else {
      supabase.auth.getSession().then(({ data }) => {
        const authUser = data.session?.user;
        if (!mounted || !authUser) return;
        const session = createSupabaseSession(authUser);
        setUser(session);
        setProgress(getLearningState(session.id));
        saveSupabaseProfile(authUser);
        const routedPage = pageFromCurrentPath();
        if (routedPage && PROTECTED_PAGES.has(routedPage)) setPage(routedPage);
        else setPage("home");
      });
    }
    const { data: listener } = supabase.auth.onAuthStateChange((event, activeSession) => {
      if (authCallbackRef.current) {
        if (event === "SIGNED_IN") supabase.auth.signOut();
        return;
      }
      const authUser = activeSession?.user;
      if (!authUser) {
        setUser(null);
        setProgress(createInitialLearningState());
        return;
      }
      const session = createSupabaseSession(authUser);
      setUser(session);
      setProgress(getLearningState(session.id));
      saveSupabaseProfile(authUser);
      if (event === "SIGNED_IN") setPage((current) => current === "auth" ? "home" : current);
    });
    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);
  const completeOnboarding = (nextProgress) => {
    if (!user?.id) return;
    setProgress(nextProgress);
    saveLearningState(user.id, nextProgress);
    setPage("home");
  };
  const applyActivity = (type, payload = {}) => {
    if (!user?.id) return;
    const current = getLearningState(user.id);
    const next = globalThis.structuredClone ? globalThis.structuredClone(current) : JSON.parse(JSON.stringify(current));
    next.dailyChallenge = next.dailyChallenge || buildDailyChallenge(next.preferences);
    next.hskProgress = { ...createInitialLearningState().hskProgress, ...(next.hskProgress || {}) };
    next.learnedWords = next.learnedWords || {};
    next.quizHistory = next.quizHistory || [];
    next.listeningHistory = next.listeningHistory || [];
    next.readingHistory = next.readingHistory || [];
    next.examHistory = next.examHistory || [];
    next.mistakeReview = next.mistakeReview || [];
    next.weakSkills = next.weakSkills || {};
    next.gamification = normalizeGamification(next);
    const today = todayKey();
    normalizeWeeklyState(next, today);
    const weekIndex = Math.max(0, next.weeklyStats.findIndex((day) => day.date === today));
    if (next.lastStudyDate !== today) {
      next.lastStudyDate = today;
      next.streak = next.streak ? next.streak + 1 : 1;
      next.studyMinutesToday = 0;
      next.dailyChallenge = next.dailyChallenge?.completed ? buildDailyChallenge(next.preferences) : next.dailyChallenge;
    }

    const addXp = (amount) => {
      next.xp += amount;
      next.weeklyStats[weekIndex].xp += amount;
    };
    const addTokens = (amount) => {
      next.gamification.tokens = Math.max(0, Number(next.gamification.tokens || 0) + Number(amount || 0));
    };
    const addReward = (xp, tokens, label) => {
      addXp(xp);
      addTokens(tokens);
      next.gamification.lastReward = { label, xp, tokens, date: new Date().toISOString() };
    };
    const bumpWeeklyQuest = (id, amount = 1) => {
      next.gamification.weeklyQuests = (next.gamification.weeklyQuests || []).map((quest) => {
        if (quest.id !== id || quest.completed) return quest;
        const value = Math.min(quest.target, Number(quest.value || 0) + amount);
        const completed = value >= quest.target;
        return { ...quest, value, completed };
      });
    };
    const advanceMission = (type) => {
      const path = next.gamification.learningPath || [];
      const activeIndex = path.findIndex((mission) => mission.status === "active" && (mission.type === type || type === "boss"));
      const index = activeIndex >= 0 ? activeIndex : path.findIndex((mission) => mission.status === "active");
      if (index < 0) return;
      const mission = path[index];
      path[index] = { ...mission, status: "completed", completedAt: new Date().toISOString() };
      if (path[index + 1]) path[index + 1] = { ...path[index + 1], status: "active" };
    };
    const bumpTask = (id, amount = 1) => {
      const task = next.dailyChallenge?.tasks?.find((item) => item.id === id);
      if (task) task.value = Math.min(task.target, task.value + amount);
      const complete = next.dailyChallenge?.tasks?.every((item) => item.value >= item.target);
      if (complete && !next.dailyChallenge.completed) {
        next.dailyChallenge.completed = true;
      }
    };
    const rewardAnswer = ({ questionId, correct = false, category = "answer", label = "Answer checked" }) => {
      if (!questionId || next.gamification.rewardedAnswers[questionId]) return false;
      const xp = correct ? 10 : 2;
      const tokens = correct ? 2 : 0;
      next.gamification.rewardedAnswers[questionId] = { correct, category, xp, tokens, date: new Date().toISOString() };
      addReward(xp, tokens, `${label}: ${correct ? "correct" : "wrong"}`);
      bumpWeeklyQuest("weekly-answers", 1);
      if (correct) bumpWeeklyQuest("weekly-correct", 1);
      if (category === "exercise") {
        bumpTask("exerciseAnswers", 1);
        advanceMission("exercise");
      }
      if (category === "quiz") {
        bumpTask("quizAnswers", 1);
        advanceMission("exercise");
      }
      if (category === "ai") {
        bumpTask("aiPractice", 1);
        advanceMission("exercise");
      }
      return true;
    };

    if (type === "word" || type === "flashcard") {
      const word = payload.word;
      if (word) {
        const existing = next.learnedWords[word.char] || { reviewCount: 0, mastery: "New" };
        const mastery = nextMastery(existing.mastery);
        next.learnedWords[word.char] = {
          chinese: word.char,
          pinyin: word.pinyin,
          meaning: word.meaning,
          dateLearned: existing.dateLearned || new Date().toISOString(),
          reviewCount: existing.reviewCount + 1,
          mastery,
          nextReview: nextReviewDate(mastery),
        };
        next.wordsLearned = Object.keys(next.learnedWords).length;
        const wordLevel = Number(word.difficulty || 1);
        if (HSK_TARGETS[wordLevel]) next.hskProgress[wordLevel] = Math.min(HSK_TARGETS[wordLevel], (next.hskProgress[wordLevel] || 0) + (existing.dateLearned ? 0 : 1));
        next.flashcardsReviewed += type === "flashcard" ? 1 : 0;
      }
    }
    if (type === "reading") {
      next.readingsCompleted += 1;
      next.readingHistory.push({ id: payload.passage?.id, title: payload.passage?.title, date: new Date().toISOString() });
    }
    if (type === "listening") {
      next.listeningCompleted += 1;
      next.listeningHistory.push({ level: payload.level, date: new Date().toISOString() });
    }
    if (type === "exercise") {
      next.exercisesCompleted += 1;
      rewardAnswer({
        questionId: payload.questionId || payload.exercise?.id || `exercise-${payload.level || "x"}-${payload.exercise?.prompt || payload.answer || next.exercisesCompleted}`,
        correct: Boolean(payload.correct),
        category: "exercise",
        label: "Exercise answer",
      });
    }
    if (type === "quiz") {
      next.quizzesCompleted += 1;
      next.quizHistory.push({ level: payload.level, score: payload.score, date: new Date().toISOString() });
      const total = Number(payload.total || 1);
      const score = Number(payload.score || 0);
      Array.from({ length: total }, (_, index) => rewardAnswer({
        questionId: `${payload.questionId || `quiz-${payload.level || "x"}-${Date.now()}`}-${index}`,
        correct: index < score,
        category: "quiz",
        label: "Quiz answer",
      }));
    }
    if (type === "ai_practice") {
      const answers = Array.isArray(payload.answers) ? payload.answers : [payload];
      answers.forEach((answer, index) => rewardAnswer({
        questionId: answer.questionId || payload.questionId || `ai-practice-${payload.level || "x"}-${index}-${Date.now()}`,
        correct: Boolean(answer.correct ?? payload.correct),
        category: "ai",
        label: payload.source || "AI Tutor practice",
      }));
      if (payload.quizComplete) {
        next.quizzesCompleted += 1;
        next.quizHistory.push({ level: payload.level, score: payload.score, total: payload.total, date: new Date().toISOString() });
      }
    }
    if (type === "exam") {
      const result = payload.result;
      next.examHistory.push(result);
      const examRewardId = result?.id || result?.examId || `${result?.examTitle || "exam"}-${result?.hskLevel || "x"}-${result?.date || ""}`;
      if (!next.gamification.rewardedAnswers[`exam-${examRewardId}`]) {
        const percentage = Math.max(0, Math.min(100, Number(result?.percentage || 0)));
        const xp = Math.round(percentage);
        const tokens = Math.floor(percentage / 10);
        next.gamification.rewardedAnswers[`exam-${examRewardId}`] = { correct: percentage >= 60, category: "exam", xp, tokens, date: new Date().toISOString() };
        addReward(xp, tokens, `Exam completed: ${percentage}%`);
        bumpTask("examAnswers", 1);
        bumpWeeklyQuest("weekly-exam", 1);
        advanceMission("boss");
      }
      (result?.wrongAnswers || []).forEach((mistake) => {
        const skill = mistake.question?.section?.toLowerCase() || "exam";
        next.weakSkills[skill] = (next.weakSkills[skill] || 0) + 1;
        next.mistakeReview.push({
          questionId: mistake.question.id,
          question: mistake.question.prompt,
          correctAnswer: mistake.correctAnswer,
          userAnswer: mistake.userAnswer,
          explanation: mistake.question.explanation,
          hskLevel: result.hskLevel,
          skillType: skill,
          date: new Date().toISOString(),
        });
      });
    }
    if (type === "grammar") {
      next.grammarCompleted += 1;
    }
    if (type === "speaking" || type === "ai") {
      next.speakingCompleted = (next.speakingCompleted || 0) + (type === "speaking" ? 1 : 0);
      next.aiLabHistory = [...(next.aiLabHistory || []), { type, label: payload.label || payload.transcript || "AI Lab task", level: payload.level, date: new Date().toISOString() }].slice(-100);
    }
    const unlockedAchievements = rpgAchievements(next).filter((achievement) => achievement.unlocked && !next.gamification.achievements[achievement.id]);
    unlockedAchievements.forEach((achievement) => {
      next.gamification.achievements[achievement.id] = { ...achievement, unlockedAt: new Date().toISOString() };
    });
    next.gamification.skillTree = skillTreeFor(next);
    next.gamification.rank = `${playerRank(playerLevelFromXp(next.xp)).icon} ${playerRank(playerLevelFromXp(next.xp)).name}`;
    next.studyMinutesToday += 3;
    next.weeklyStats[weekIndex].minutes += 3;
    setProgress(next);
    saveLearningState(user.id, next);
  };
  const logout = async () => {
    await supabase?.auth.signOut();
    writeStorage(AUTH_SESSION_KEY, null);
    writeStorage(LEGACY_AUTH_SESSION_KEY, null);
    setUser(null);
    setProgress(createInitialLearningState());
    setPage("home");
  };
  const updateUserSession = (session) => {
    setUser(session);
  };
  const resetProgress = () => {
    if (!user?.id) return;
    const current = getLearningState(user.id);
    const reset = {
      ...createInitialLearningState(),
      onboardingComplete: current.onboardingComplete,
      preferences: current.preferences,
      subscription: current.subscription,
      settings: current.settings,
    };
    updateProgress(reset);
  };
  const cancelSubscription = () => {
    if (!user?.id) return;
    const current = getLearningState(user.id);
    updateProgress({
      ...current,
      subscription: {
        ...(current.subscription || {}),
        planType: "free",
        planId: "free",
        period: null,
        status: "free",
        expiresAt: null,
        trialActive: false,
        paymentHistory: [
          ...(current.subscription?.paymentHistory || []),
          { type: "cancellation", date: new Date().toISOString() },
        ],
      },
    });
  };
  const reviewExamWithTutor = (result, exam) => {
    const wrong = result?.wrongAnswers || [];
    const reviewPrompt = wrong.length
      ? `Review my HSK ${result.hskLevel} exam mistakes from ${result.examTitle}. Focus on these wrong answers:\n${wrong.slice(0, 8).map((item, index) => `${index + 1}. Question ${item.question.number}: ${item.question.prompt}\nMy answer: ${answerLabel(item.question, item.userAnswer)}\nCorrect answer: ${answerLabel(item.question, item.correctAnswer)}`).join("\n\n")}`
      : `Review my HSK ${result?.hskLevel || exam?.hskLevel} exam attempt from ${result?.examTitle || exam?.title}. The uploaded PDF did not include an answer key, so help me review strategies for the sections I answered: Listening, Reading, and Writing.`;
    const messages = [
      ...loadTutorConversation(),
      { role: "user", content: reviewPrompt, audioItems: [] },
      { role: "assistant", content: "I saved your exam review request here. Send “start review” and I’ll help you analyze the exam and create focused practice from your weak areas.", audioItems: [] },
    ].slice(-20);
    writeStorage(TUTOR_CONVERSATION_KEY, messages);
    writeStorage(TUTOR_STATE_KEY, {
      ...createTutorState(),
      currentTopic: { type: "examReview", examId: exam?.id, result },
      lastExercise: { type: "examReview", result },
    });
    setPage("tutor");
  };
  const activeSettings = normalizeSettings(progress?.settings);
  const language = activeSettings.language.appLanguage || "English";
  const themeClass = activeSettings.appearance.theme === "Light mode" ? "hz-theme-light" : activeSettings.appearance.theme === "AMOLED dark" ? "hz-theme-amoled" : "hz-theme-dark";
  const accentClass = `hz-accent-${activeSettings.appearance.accentColor.toLowerCase()}`;
  const isRtl = language === "Arabic";
  const t = (key) => uiText(language, key);
  const premiumAccess = subscriptionIsPremium(progress);
  const learningAccess = subscriptionHasLearningAccess(progress);
  const pages = {
    home: <Hero setPage={goPage} user={user} onSignup={() => openAuth("signup")} onSelectVocabLevel={openVocabularyLevel} />,
    vocab: <Vocabulary onActivity={applyActivity} premium={learningAccess} onUpgrade={() => setPage("pricing")} settings={activeSettings} selectedLevel={selectedVocabLevel} onSelectedLevelChange={setSelectedVocabLevel} />,
    reading: <Reading onActivity={applyActivity} premium={learningAccess} onUpgrade={() => setPage("pricing")} settings={activeSettings} />,
    grammar: <Grammar onActivity={applyActivity} settings={activeSettings} />,
    listening: <ListeningSectionV2 onActivity={applyActivity} premium={learningAccess} onUpgrade={() => setPage("pricing")} settings={activeSettings} />,
    exercises: <ExerciseSection onActivity={applyActivity} premium={learningAccess} onUpgrade={() => setPage("pricing")} settings={activeSettings} />,
    exam: <ExamSection progress={progress} onActivity={applyActivity} onReviewWithTutor={reviewExamWithTutor} settings={activeSettings} />,
    ailab: <PremiumAiLab progress={progress} onActivity={applyActivity} settings={activeSettings} />,
    tutor: premiumAccess ? <Tutor onActivity={applyActivity} language={language} settings={activeSettings} /> : <PremiumGate language={language} onStartTrial={startFreeTrial} onSubscribe={() => setPage("pricing")} />,
    dashboard: <Dashboard user={user} progress={progress} language={language} onUpgrade={() => setPage("pricing")} />,
    pricing: <PricingPage user={user} progress={progress} language={language} onChoosePlan={choosePlan} onStartTrial={startFreeTrial} />,
    payment: <PaymentPage plan={selectedPlan} progress={progress} onBack={() => setPage("pricing")} onSuccess={completePayment} />,
    settings: <SettingsPage user={user} progress={progress} language={language} onSaveProgress={updateProgress} onUpdateUser={updateUserSession} onResetProgress={resetProgress} onCancelSubscription={cancelSubscription} onUpgrade={() => setPage("pricing")} onLogout={logout} onSignIn={() => openAuth("login")} />,
    admin: <AdminDashboard user={user} />,
    auth: <AuthPage mode={authMode} setMode={setAuthMode} onSuccess={handleAuthSuccess} notice={authNotice} />,
    "auth-callback": <AuthCallbackPage />,
    onboarding: <Onboarding user={user} progress={progress} onComplete={completeOnboarding} />,
  };
  const nav = [
    ["home", "首页 Home"],
    ["vocab", "词汇 Vocab"],
    ["reading", "阅读 Reading"],
    ["listening", "听力 Listening"],
    ["exercises", "练习 Exercises"],
    ["exam", "考试 Exam"],
    ["grammar", "语法 Grammar"],
    ["ailab", "AI Lab"],
    ["tutor", "AI Tutor"],
    ["pricing", "Plans"],
    ["dashboard", "Dashboard"],
    ["settings", "Settings"],
  ];
  const visitorNav = [["features", "Features"], ["pricing", "Plans"]];
  const memberNav = normalizeEmail(user?.email) === ADMIN_EMAIL ? [...nav, ["admin", "Admin"]] : nav;
  const localizedNav = user ? memberNav.map(([id, fallback]) => [id, t(id) === id ? fallback : t(id)]) : visitorNav;
  const learningTopNav = user
    ? [
        ["vocab", "Vocabulary"],
        ["reading", "Reading"],
        ["listening", "Listening"],
        ["exercises", "Exercises"],
        ["exam", "Exam"],
        ["grammar", "Grammar"],
      ].map(([id, fallback]) => [id, t(id) === id ? fallback : t(id)])
    : [["features", "Features"], ["pricing", "Plans"]];
  const memberBottomNav = [
    ["ailab", "AI Lab"],
    ["tutor", "AI Tutor"],
    ["pricing", "Plans"],
    ["dashboard", "Dashboard"],
    ["settings", "Settings"],
    ...(normalizeEmail(user?.email) === ADMIN_EMAIL ? [["admin", "Admin"]] : []),
  ].map(([id, fallback]) => [id, t(id) === id ? fallback : t(id)]);

  return (
    <div className={`hz-app ${themeClass} ${accentClass} ${isRtl ? "hz-rtl" : ""} ${activeSettings.appearance.compactMode ? "hz-compact" : ""}`} dir={isRtl ? "rtl" : "ltr"} style={{ fontSize: activeSettings.appearance.fontSize }}>
      <GlobalStyles />
      <AudioNotice />
      <nav className="hz-nav">
        <div className="hz-logo" onClick={() => goPage("home")}><span style={{ fontSize: "1.7rem" }}>汉</span><span>HanZi AI</span></div>
        <div className="hz-links">{learningTopNav.map(([id, label]) => <button key={id} className={page === id ? "active" : ""} onClick={() => goPage(id === "features" ? "home" : id)}>{label}</button>)}</div>
        <div className="hz-xp">
          {user ? (
            <>
              <div className="hz-card" style={{ padding: "6px 12px", color: "#F5C842", fontWeight: 800, fontSize: ".76rem" }}>你好, {user.name} · {subscriptionName(progress)}</div>
              <button className="hz-tab" onClick={logout}>Logout</button>
            </>
          ) : (
            <>
              <button className="hz-tab" onClick={() => openAuth("login")}>Login</button>
              <button className="hz-gold-btn" style={{ padding: "8px 13px" }} onClick={() => openAuth("signup")}>Sign Up</button>
            </>
          )}
        </div>
      </nav>
      <WordLookupContext.Provider value={{ onSaveWord: (word) => applyActivity("word", { word }) }}>
        <main className="hz-main">{pages[page]}</main>
      </WordLookupContext.Provider>
      {user && (
        <nav className="hz-bottom-nav">
          <div className="hz-bottom-logo" onClick={() => goPage("home")}><span>{"\u6C49"}</span><span>HanZi AI</span></div>
          <div className="hz-bottom-links">
            {memberBottomNav.map(([id, label]) => <button key={id} className={page === id ? "active" : ""} onClick={() => goPage(id)}>{label}</button>)}
          </div>
        </nav>
      )}
      <footer style={{ borderTop: "1px solid rgba(212,175,55,.1)", padding: "24px 20px", textAlign: "center", color: "rgba(237,232,220,.34)", fontSize: ".78rem" }}>
        <span style={{ fontFamily: "'Noto Serif SC',serif", color: "rgba(245,200,66,.5)", fontSize: "1rem" }}>汉智 HanZi AI</span>
        <span style={{ margin: "0 12px" }}>·</span>
        HSK 1-4 Complete Learning Platform
      </footer>
    </div>
  );
}
