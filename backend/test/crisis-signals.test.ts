import { describe, expect, it } from "vitest";
import { readCrisisSignals } from "../src/crisis-check.ts";

describe("clear risk signals", () => {
  it.each([
    ["I want to kill myself"],
    ["i wanna kms... no, I mean it, I want to kill myself tonight"],
    ["I’m going to end my life"],
    ["im suicidal"],
    ["im sucidal"],
    ["I've been having suicidal thoughts"],
    ["I want to die"],
    ["i wish i was dead"],
    ["I wish I'd never been born"],
    ["I'd rather be dead"],
    ["I'd rather die than keep living like this"],
    ["I don't want to live anymore"],
    ["I don't want to live."],
    ["I don't want to live with this pain anymore"],
    ["life isn't worth living"],
    ["I want to go to sleep and never wake up"],
    ["I want to end it."],
    ["everyone would be better off without me"],
    ["there's no reason to live"],
    ["I took too many pills"],
    ["I've been cutting myself again"],
    ["I've been hurting myself"],
    ["I'm going to jump off the bridge"],
    ["I'm in danger right now"],
    ["there's a shooter in my building"],
    ["I'm not ok i want to die"],
    ["I'm not kidding, I want to kill myself"],
    ["I WANT TO   DIE"],
  ])("%s", (text) => {
    expect(readCrisisSignals(text)).toBe("crisis");
  });

  // A saying in the same message must never take a real signal with it.
  it.each([
    ["this exam is killing me and I want to kill myself"],
    ["I failed my exam and I want to kill myself"],
    ["I lost my job and I want to kill myself"],
    ["my head keeps telling me to kill myself"],
    ["this class is so hard, I want to die"],
    ["my phone is dead and I want to die"],
  ])("alongside a saying: %s", (text) => {
    expect(readCrisisSignals(text)).toBe("crisis");
  });
});

describe("signals that aren't clear either way", () => {
  it.each([
    ["I can't do this anymore"],
    ["I don't see the point anymore"],
    ["what's the point of any of this"],
    ["I feel hopeless"],
    ["I'm such a burden on my family"],
    ["nobody would even notice if I disappeared"],
    ["I don't feel safe at home"],
    ["my roommate is suicidal"],
    ["he's going to kill me"],
    ["he came back and he's going to kill me"],
    ["my mom is gonna kill me if I fail"],
    ["please just kill me"],
    ["I'm not going to kill myself"],
    ["I'm not suicidal, just tired"],
    ["I don't want to die"],
    ["i want to die lol"],
    ["I hurt myself"],
    ["I keep hurting myself at the gym"],
    ["I took all my meds this morning"],
    ["I'm gonna die"],
    ["if I see one more integral I'm gonna die"],
    ["I'm thinking of ending things"],
    ["I don't want to live with this roommate"],
    ["my boyfriend beats me"],
    ["this exam is killing me and I can't go on"],
  ])("%s", (text) => {
    expect(readCrisisSignals(text)).toBe("check-in");
  });
});

describe("messages with nothing to act on", () => {
  it.each([
    ["This exam is killing me"],
    ["this exam is killing me lol"],
    ["orgo is literally killing me"],
    ["ochem is killing me"],
    ["School is killing me"],
    ["this week is killing me"],
    ["my knee is killing me"],
    ["my feet are killing me"],
    ["finals are gonna kill me"],
    ["I killed it on that presentation"],
    ["you're killing it"],
    ["I need to kill time before class"],
    ["I'd kill for a coffee"],
    ["How do I kill a process in Linux?"],
    ["I'd rather die than take another 8am"],
    ["I'm dying of laughter"],
    ["I'm gonna die laughing"],
    ["I'm dying to see that movie"],
    ["my phone is dying"],
    ["my phone is going to die"],
    ["I'm going to be dead tired tomorrow"],
    ["dropping that class would be academic suicide"],
    ["I really shot myself in the foot, I could shoot myself in the foot again"],
    ["I need to cut myself some slack"],
    ["I'll shoot myself a reminder"],
    ["I'm taking my life back"],
    ["I don't want to live on campus next year"],
    ["I don't want to live downtown"],
    ["What are office hours?"],
    ["How do I book an appointment at Tuttleman Counseling?"],
    ["I have a skill gap in calculus"],
  ])("%s", (text) => {
    expect(readCrisisSignals(text)).toBe("nothing");
  });
});
