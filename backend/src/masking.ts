/** What Buddy leaves in place of what it hid. Claude's system prompt explains these too. */
export const HIDDEN_MARKS = {
  password: "[password hidden]",
  ssn: "[Social Security number hidden]",
  card: "[card number hidden]",
};

const KEYWORD =
  "(?:(?<![\\p{L}\\p{N}])(?:pass(?:word|wd|code|phrase)|pwd|pw|pin|contrase[ñn]a|senha|mot de passe|passwort|kennwort|пароль)|كلمة (?:المرور|السر)|密码|密碼|パスワード|비밀번호)";
/** Which account the password is for, as in "my password for TU Portal is". */
const FOR_WHAT = "(?:\\s+(?:for|on)(?:\\s+[\\p{L}\\p{N}]+){1,3}?)?";
/**
 * The words between "password" and the password itself. "To" and "as" only count after a word for
 * changing it, because "my password to get into Canvas" isn't giving one.
 */
const CONNECTOR =
  "(?:\\s+(?:(?:is|was)\\s+)?(?:now\\s+)?(?:changed|set|reset|updated)\\s+to\\s+|\\s*['’]s\\s+|\\s+(?:is|was|would be|es|est|ist|é|era|это|هي)(?:\\s+(?:now|still|just))?\\s+|\\s+-\\s+|\\s+(?<=\\b(?:change|changed|changing|set|reset|update|updated)\\b[^.\\n]{0,30})(?:to|as)\\s+|\\s*(?:是|为|為|は|은|는)\\s*)";

const AFTER_COLON = new RegExp(
  `((?:${KEYWORD}|(?<![\\p{L}\\p{N}])pass)${FOR_WHAT}(?:\\s+(?:is|was))?\\s*[:：=]\\s*)[^\\n]+`,
  "giu",
);
const AFTER_WORD = new RegExp(`(${KEYWORD}${FOR_WHAT}${CONNECTOR})("[^"\\n]+"|'[^'\\n]+'|“[^”\\n]+”|\\S+)`, "giu");
/** However it's phrased, as in "the password I use is hunter2". */
const WORDS_AFTER_KEYWORD = new RegExp(`(${KEYWORD})((?:[^\\S\\n]+\\S+){1,6})`, "giu");

/** Words that follow "my password is" in ordinary talk about a password, rather than a password. */
const NOT_A_PASSWORD = new Set(
  `a an the my your it this that same and but so what how for in on at of not no too very also just really still
   probably maybe always never only now already
   expired wrong incorrect invalid correct right required needed used locked blocked broken working reset changed
   different old new weak strong long short good bad safe secure easy hard best
   get log login sign access use open
   incorrecta incorrecto falsch errada`
    .split(/\s+/),
);

const SSN_SEPARATOR = "(?:[ \\t\\u00A0]?[-–—.][ \\t\\u00A0]?|[ \\t\\u00A0])";
const SSN_SHAPED = new RegExp(`(?<!\\d)\\d{3}${SSN_SEPARATOR}\\d{2}${SSN_SEPARATOR}\\d{4}(?!\\d)`, "g");
const NINE_DIGITS = /(?<!\d)\d(?:[ \t .\-–—]?\d){8}(?!\d)/g;
const NAMES_AN_SSN =
  /\bss#|\bssn(?![a-z])|\bss (?:number|no\b|#)|\bsocial security\b|\bmy social\b|\bseguro social\b|sécurité sociale/i;
const DIGIT_RUN = /\d+(?:[\s._/–—-]{1,3}\d+)*/g;

/**
 * Hides passwords, Social Security numbers and card numbers. Everything the Student types goes
 * through this before it's saved or sent to Claude. It leans toward hiding: a number hidden by
 * mistake costs little, and one let through can't be taken back. Labelled passwords go first, so
 * that one made of digits is hidden whole, and the looser search for them goes last, so that a
 * card or Social Security number near the word is still called what it is.
 */
export function maskSecrets(text: string): string {
  const withoutLabelledPasswords = text
    .replace(AFTER_COLON, (_, lead: string) => lead + HIDDEN_MARKS.password)
    .replace(AFTER_WORD, (whole: string, lead: string, value: string) =>
      NOT_A_PASSWORD.has(bareWord(value)) ? whole : lead + HIDDEN_MARKS.password,
    );
  const withoutCards = withoutLabelledPasswords.replace(DIGIT_RUN, hideCardsInRun);
  const withoutShapedSsns = withoutCards.replace(SSN_SHAPED, HIDDEN_MARKS.ssn);
  const withoutSsns = NAMES_AN_SSN.test(withoutShapedSsns)
    ? withoutShapedSsns.replace(NINE_DIGITS, HIDDEN_MARKS.ssn)
    : withoutShapedSsns;
  return withoutSsns.replace(
    WORDS_AFTER_KEYWORD,
    (_, keyword: string, words: string) =>
      keyword + words.replace(/\S+/g, (word) => (looksLikeASecret(word) ? HIDDEN_MARKS.password : word)),
  );
}

/** What to tell the Student about text that has been through maskSecrets, or null if nothing was hidden. */
export function hiddenNote(maskedText: string): string | null {
  const hidden = [
    maskedText.includes(HIDDEN_MARKS.password) && "a password",
    maskedText.includes(HIDDEN_MARKS.ssn) && "a Social Security number",
    maskedText.includes(HIDDEN_MARKS.card) && "a card number",
  ].filter((kind) => kind !== false);
  if (hidden.length === 0) return null;
  const list = hidden.length === 1 ? hidden[0] : `${hidden.slice(0, -1).join(", ")} and ${hidden.at(-1)}`;
  return `Buddy hid what looks like ${list} before saving this or sending it to the AI.`;
}

function bareWord(value: string): string {
  return value.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

function looksLikeASecret(word: string): boolean {
  return /\d{4}/.test(word) || (/\p{L}/u.test(word) && /\d/.test(word));
}

/**
 * Checks every stretch of neighbouring digit groups, because a card number often has an expiry
 * date or security code right after it, which would throw off the checksum. Other digits can pass
 * the checksum together with part of a card, so every stretch that passes is hidden, not just the
 * first one found. Otherwise the rest of the card would stay visible.
 */
function hideCardsInRun(run: string): string {
  const groups = [...run.matchAll(/\d+/g)].map((match) => ({
    digits: match[0],
    start: match.index,
    end: match.index + match[0].length,
    hide: false,
  }));

  groups.forEach((_, first) => {
    let digits = "";
    for (let last = first; last < groups.length && digits.length <= 19; last++) {
      digits += groups[last]!.digits;
      if (digits.length >= 13 && digits.length <= 19 && passesCardChecksum(digits)) {
        groups.slice(first, last + 1).forEach((group) => (group.hide = true));
      }
    }
  });

  let masked = "";
  let copiedUpTo = 0;
  groups.forEach((group, index) => {
    if (!group.hide) return;
    if (!groups[index - 1]?.hide) masked += run.slice(copiedUpTo, group.start) + HIDDEN_MARKS.card;
    copiedUpTo = group.end;
  });
  return masked + run.slice(copiedUpTo);
}

/** The Luhn check: doubling every second digit from the right must give a total ending in 0. */
function passesCardChecksum(digits: string): boolean {
  let total = 0;
  for (let position = 0; position < digits.length; position++) {
    const digit = Number(digits[digits.length - 1 - position]);
    const doubled = position % 2 === 1 ? digit * 2 : digit;
    total += doubled > 9 ? doubled - 9 : doubled;
  }
  return total % 10 === 0;
}
