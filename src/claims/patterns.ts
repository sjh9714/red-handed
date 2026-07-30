import type { ClaimFamily } from "../types.js";

/**
 * Claim patterns, kept as data so a locale can be added without touching logic.
 *
 * Korean ships in v1 alongside English because Claude Code answers in the user's
 * language: an English-only matcher silently finds nothing in a Korean session.
 * A missed claim is a missed finding, never a false accusation, so being wrong
 * here costs recall and not trust.
 */
export interface ClaimPattern {
  family: ClaimFamily;
  pattern: RegExp;
}

export interface LocalePack {
  id: string;
  claims: ClaimPattern[];
  /** Anything that makes the sentence an intention, a condition, or a denial. */
  reject: RegExp[];
  /** Hedging: still a claim, but a soft one. */
  hedge: RegExp[];
}

const english: LocalePack = {
  id: "en",
  claims: [
    // The filler group lets hedged wording through ("tests should pass"); the
    // hedge list then downgrades it rather than the pattern missing it entirely.
    { family: "test-pass", pattern: /\b(?:all\s+)?(?:\d+\s+)?(?:unit|integration|e2e|new\s+)?tests?\s+(?:(?:now|all|still|again|probably|likely|hopefully|should|seems?|appears?|to|do|does|did|are|is|currently|already)\s+){0,3}(?:pass(?:es|ing|ed)?|are\s+green|is\s+green|succeed(?:s|ed)?)\b/i },
    { family: "test-pass", pattern: /\btests?\s+(?:are|is)\s+(?:now\s+|all\s+)?(?:green|passing|clean)\b/i },
    { family: "test-pass", pattern: /\btest\s+suite\s+(?:is\s+)?(?:now\s+)?(?:green|passing|clean|pass(?:es)?)\b/i },
    { family: "test-pass", pattern: /\b\d+\s*(?:\/\s*\d+\s*)?tests?\s+(?:pass(?:ing|ed|es)?)\b/i },
    { family: "test-pass", pattern: /[✅✓][^\n]{0,40}\btests?\b[^\n]{0,20}\b(?:pass\w*|green)\b/i },
    { family: "test-pass", pattern: /\|[^|\n]*\btests?\b[^|\n]*\|[^|\n]*(?:[✅✓]|\bpass\w*|\bgreen\b)[^|\n]*\|/i },
    { family: "build-pass", pattern: /\b(?:typecheck|type-check|tsc|build|lint(?:er)?|compile)\s+(?:is\s+|now\s+)?(?:pass(?:es|ing|ed)?|succeed(?:s|ed)?|clean|green)\b/i },
    { family: "build-pass", pattern: /\bno\s+(?:more\s+)?(?:type|lint|compile|compiler|build)\s+errors?\b/i },
    { family: "build-pass", pattern: /\b(?:typecheck|build|lint)\s+(?:is\s+)?clean\b/i },
  ],
  reject: [
    /\?\s*$/,
    /\b(?:if|unless|once|when|whether|assuming|in\s+case)\b/i,
    /\b(?:will|won't|would|going\s+to|i'll|let\s+me|let's|next\s+i|need\s+to|needs?\s+to|have\s+to|must)\b/i,
    /\b(?:make\s+sure|ensure|confirm|verify|check)\b/i,
    /\b(?:do(?:es)?n't|didn't|isn't|aren't|not)\b/i,
    /\b(?:fail(?:s|ed|ing|ure)?|broken|errors?\s+remain)\b/i,
    /\bTODO\b/,
    // A partial result is not a claim that the suite is green.
    /\b\d+\s+of\s+\d+\b/i,
    /\b(?:some|most|partial(?:ly)?|remaining|rest)\b/i,
  ],
  hedge: [/\b(?:should|probably|likely|hopefully|seems?|appears?|may|might|expect(?:ed)?\s+to|i\s+think)\b/i],
};

const korean: LocalePack = {
  id: "ko",
  // No \b anywhere: JavaScript word boundaries are defined over [A-Za-z0-9_],
  // so \b never matches between a Hangul syllable and punctuation.
  claims: [
    { family: "test-pass", pattern: /테스트[^\n]{0,20}?통과/ },
    { family: "test-pass", pattern: /(?:전부|모두|모든|다)\s*테스트[^\n]{0,10}?통과/ },
    { family: "test-pass", pattern: /테스트[^\n]{0,20}?성공/ },
    { family: "test-pass", pattern: /테스트[^\n]{0,10}(?:그린|초록)/ },
    { family: "build-pass", pattern: /(?:빌드|타입체크|타입\s*체크|린트|컴파일)[^\n]{0,10}?(?:성공|통과|깨끗)/ },
    { family: "build-pass", pattern: /(?:타입|린트|컴파일|빌드)\s*에러[^\n]{0,10}?없(?:습니다|음|어요|다)/ },
  ],
  reject: [
    /\?\s*$/,
    /(?:실패|깨졌|에러가?\s*남|안\s*됨|안\s*됩니다|못\s*했)/,
    /(?:하면|하려면|해야|하는지|할지|인지)\s/,
    /(?:할게|하겠|할\s*예정|확인|검증|돌려\s*보|실행하겠|해\s*보겠)/,
    /(?:아직|않았|않습니다|않음|없이는)/,
    // "6개 중 5개 통과" reports a partial result, not a green suite.
    /\d+\s*(?:개|건|것)?\s*중\s*\d+/,
    /(?:일부|나머지|절반)/,
    // "통과시키는", "통과하는": describing what code should do, not what it did.
    /통과(?:시키|하는|할|시킬|되도록|하도록|시켜)/,
  ],
  hedge: [/(?:같습니다|같아요|듯|아마|보입니다|예상)/],
};

/**
 * Japanese. As with Korean, no `\b` anywhere: JavaScript word boundaries are
 * defined over [A-Za-z0-9_] and never match against kana or kanji.
 *
 * The rejects carry most of the weight. `通す` is the causative — "make the
 * tests pass" — and describes work still to be done, which is the opposite of
 * `通った`, the plain past. Getting those two confused is exactly the false
 * accusation this tool must not make.
 */
const japanese: LocalePack = {
  id: "ja",
  claims: [
    { family: "test-pass", pattern: /テスト[^\n]{0,20}?(?:通り|通っ|通過|パス)/ },
    { family: "test-pass", pattern: /テスト[^\n]{0,20}?成功/ },
    { family: "test-pass", pattern: /テスト[^\n]{0,10}(?:グリーン|緑)/ },
    {
      family: "build-pass",
      pattern:
        /(?:ビルド|型チェック|タイプチェック|リント|コンパイル)[^\n]{0,10}?(?:成功|通り|通っ|通過|パス|クリーン)/,
    },
    {
      family: "build-pass",
      pattern: /(?:型|リント|コンパイル|ビルド)エラー[^\n]{0,10}?(?:ありません|無い|ない)/,
    },
  ],
  reject: [
    /[?？]\s*$/,
    /(?:失敗|落ち[たて]|エラーが残|通りません|通っていません|できません|できなかった)/,
    // Intentions and plans: something the agent is about to do, not something done.
    /(?:確認し|検証し|実行し|してみ|する予定|しましょう|してから)/,
    /(?:まだ|ていません|ていない)/,
    // "make the tests pass" — a goal, not a result.
    /(?:通す|通るように|通すため|パスさせ|通そう)/,
    /\d+\s*(?:件|個|つ)?中\s*\d+/,
    /(?:一部|残り|半分)/,
  ],
  hedge: [/(?:と思います|でしょう|はず|多分|たぶん|ようです|みたいです|かもしれ)/],
};

/**
 * Chinese, simplified and traditional together. Character classes rather than
 * two packs, because a session mixes them freely and the alternative is
 * maintaining the same rule twice.
 */
const chinese: LocalePack = {
  id: "zh",
  claims: [
    { family: "test-pass", pattern: /[测測][试試][^\n]{0,20}?通[过過]/ },
    { family: "test-pass", pattern: /[测測][试試][^\n]{0,10}?[绿綠]色/ },
    {
      family: "build-pass",
      pattern:
        /(?:构建|構建|建置|编译|編譯|类型检查|類型檢查|类型檢查|检查|檢查)[^\n]{0,10}?(?:成功|通[过過])/,
    },
    { family: "build-pass", pattern: /(?:没有|沒有|无|無)[^\n]{0,8}(?:错误|錯誤)/ },
  ],
  reject: [
    /[?？]\s*$/,
    /(?:失败|失敗|没通[过過]|沒通[过過]|未通[过過]|报错|報錯)/,
    /(?:还没|還沒|尚未|还未|還未)/,
    // Intentions, and the causative "make the tests pass".
    /(?:先运行|先執行|我先|将要|將要|准备|準備|确认是否|確認是否|检查一下|檢查一下|让|讓|使)/,
    /\d+[^\n]{0,6}中[^\n]{0,6}\d+/,
    /(?:部分|其余|其餘|剩下)/,
  ],
  hedge: [/(?:应该|應該|可能|大概|似乎|好像|预计|預計)/],
};

export const LOCALE_PACKS: LocalePack[] = [english, korean, japanese, chinese];
