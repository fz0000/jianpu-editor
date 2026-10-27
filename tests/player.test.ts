import { describe, expect, it } from 'vitest';
import {
  buildPlaybackPlan,
  findPlanIndexAtBeat,
  firstSoundingIndex,
  isPlayableNote,
  type PlayNote,
} from '../src/audio/player';
import {
  barBeatLength,
  makeBar,
  makeDash,
  makeNote,
  makeRest,
  makeScore,
  type Bar,
  type Degree,
  type Score,
} from '../src/core/model';

function score(bars: Bar[]): Score {
  return makeScore({ tonic: { letter: 'C', accidental: 'natural' }, tempo: 100 }, bars);
}

/** 计划中真正发声的音符（连音线后续音符 tied=true 不发声，休止符项 kind='rest' 不发声） */
function sounding(plan: PlayNote[]): PlayNote[] {
  return plan.filter((n) => n.kind === 'note' && !n.tied);
}

describe('播放计划：连音线（tie）时值相加', () => {
  it('同音高连音线合并成一个发声音符，时值为两者之和', () => {
    const plan = buildPlaybackPlan(score([makeBar([makeNote(5, 4), makeNote(5, 4, { tie: true })])]));

    expect(plan.length).toBe(2);
    expect(plan[0].tied).toBe(false);
    expect(plan[1].tied).toBe(true);
    expect(sounding(plan).length).toBe(1);
    expect(plan[0].beats).toBeCloseTo(2);
    expect(plan[0].startBeat).toBe(0);
    // 后续音符保留在计划中，用于跟随高亮
    expect(plan[1].startBeat).toBeCloseTo(1);
    expect(plan[1].beats).toBeCloseTo(1);
    expect(plan[1].midi).toBe(plan[0].midi);
  });

  it('跨小节连音线同样合并（前一小节二分 + 后一小节四分 = 3 拍）', () => {
    const plan = buildPlaybackPlan(
      score([
        makeBar([makeNote(3, 4), makeNote(5, 2)]),
        makeBar([makeNote(5, 4, { tie: true }), makeNote(1, 4)]),
      ]),
    );

    const notes = sounding(plan);
    expect(notes.map((n) => n.beats)).toEqual([1, 3, 1]);
    expect(notes[1].midi).toBe(67);
    expect(plan[2].eventId).not.toBe(plan[1].eventId);
    expect(plan[2].barIndex).toBe(1);
    expect(plan[2].tied).toBe(true);
  });

  it('三个以上音符的连音线链全部累加到链首', () => {
    const plan = buildPlaybackPlan(
      score([
        makeBar([makeNote(5, 4), makeNote(5, 4, { tie: true })]),
        makeBar([makeNote(5, 8, { tie: true }), makeNote(5, 4, { tie: true })]),
      ]),
    );

    expect(sounding(plan).length).toBe(1);
    expect(plan[0].beats).toBeCloseTo(3.5);
    expect(plan.map((n) => n.tied)).toEqual([false, true, true, true]);
  });

  it('附点与连音线相加：附点四分（1.5）+ 八分（0.5）= 2 拍', () => {
    const plan = buildPlaybackPlan(score([makeBar([makeNote(3, 4, { dotted: true }), makeNote(3, 8, { tie: true })])]));

    expect(sounding(plan).length).toBe(1);
    expect(plan[0].beats).toBeCloseTo(2);
  });

  it('延长线与连音线叠加：四分 + 延长线（1 拍）+ 连音线四分 = 3 拍', () => {
    const plan = buildPlaybackPlan(score([makeBar([makeNote(5, 4), makeDash(), makeNote(5, 4, { tie: true })])]));

    expect(sounding(plan).length).toBe(1);
    expect(plan[0].beats).toBeCloseTo(3);
  });

  it('休止符之后的连音线没有可合并的音，正常发声', () => {
    const plan = buildPlaybackPlan(
      score([makeBar([makeNote(5, 4), makeRest(4), makeNote(5, 4, { tie: true })])]),
    );

    expect(sounding(plan).length).toBe(2);
    expect(sounding(plan).map((n) => n.beats)).toEqual([1, 1]);
  });

  it('全曲第一个音符带连音线时正常发声', () => {
    const plan = buildPlaybackPlan(score([makeBar([makeNote(5, 4, { tie: true }), makeNote(1, 4)])]));

    expect(sounding(plan).length).toBe(2);
    expect(plan[0].tied).toBe(false);
  });

  it('连音线连接不同音高（含八度）时分别演奏，不合并', () => {
    const plan = buildPlaybackPlan(
      score([
        makeBar([
          makeNote(1, 4),
          makeNote(5, 4, { tie: true }),
          makeNote(5, 4, { octave: 1, tie: true }),
        ]),
      ]),
    );

    expect(sounding(plan).length).toBe(3);
    expect(sounding(plan).map((n) => n.beats)).toEqual([1, 1, 1]);
    expect(plan.map((n) => n.midi)).toEqual([60, 67, 79]);
  });

  it('连音线不改变总拍数，也不留空隙', () => {
    const bars = [
      makeBar([makeNote(5, 2), makeNote(5, 4, { tie: true })]),
      makeBar([makeNote(1, 4), makeNote(1, 4, { tie: true }), makeNote(3, 2)]),
    ];
    const s = score(bars);
    const plan = buildPlaybackPlan(s);

    const totalBeats = bars.reduce((acc, b) => acc + barBeatLength(b), 0);
    expect(Math.max(...plan.map((n) => n.startBeat + n.beats))).toBeCloseTo(totalBeats);

    // 发声音符首尾相接，没有因合并产生的空隙
    const notes = sounding(plan);
    for (let i = 1; i < notes.length; i += 1) {
      expect(notes[i].startBeat).toBeCloseTo(notes[i - 1].startBeat + notes[i - 1].beats);
    }
  });

  it('无连音线的乐谱播放计划保持原样', () => {
    const plan = buildPlaybackPlan(score([makeBar([makeNote(1, 4), makeNote(2, 4), makeNote(3, 4)])]));

    expect(plan.length).toBe(3);
    expect(plan.every((n) => n.tied === false)).toBe(true);
    expect(plan.map((n) => n.beats)).toEqual([1, 1, 1]);
  });

});

describe('播放高亮：休止符也进计划', () => {
  const plan = buildPlaybackPlan(
    score([makeBar([makeNote(1, 4), makeRest(4), makeRest(8), makeNote(2, 2)])]),
  );

  it('休止符作为 kind=rest 项进入计划，时值与位置正确，不发声', () => {
    expect(plan.map((n) => n.kind)).toEqual(['note', 'rest', 'rest', 'note']);
    const rests = plan.filter((n) => n.kind === 'rest');
    expect(rests.map((n) => [n.startBeat, n.beats])).toEqual([[1, 1], [2, 0.5]]);
    expect(rests.every((n) => n.tied === false)).toBe(true);
    // 休止符没有音高，取音高前要先判 kind（main.ts 的位置栏据此写「休止」）
    expect(rests.every((n) => Number.isNaN(n.midi))).toBe(true);
    expect(sounding(plan).map((n) => n.startBeat)).toEqual([0, 2.5]);
  });

  it('播放经过休止符时命中休止符项，休止符结束回到音符', () => {
    expect(findPlanIndexAtBeat(plan, 0.5)).toBe(0);
    expect(findPlanIndexAtBeat(plan, 1.5)).toBe(1);
    expect(findPlanIndexAtBeat(plan, 2.2)).toBe(2);
    expect(findPlanIndexAtBeat(plan, 3)).toBe(3);
  });

  it('末尾休止符计入总时长，全曲不会提前结束', () => {
    const withTail = buildPlaybackPlan(score([makeBar([makeNote(1, 4), makeRest(2)])]));
    const totalBeats = withTail.reduce((acc, n) => Math.max(acc, n.startBeat + n.beats), 0);
    expect(totalBeats).toBeCloseTo(3);
    expect(findPlanIndexAtBeat(withTail, 2.5)).toBe(1);
    expect(findPlanIndexAtBeat(withTail, 3)).toBe(-1);
  });

  it('休止符打断连音线链，且不打断增时线的时值累加', () => {
    const bars = [
      // 休止符后的连音线没有可合并的音
      makeBar([makeNote(5, 4), makeRest(4), makeNote(5, 4, { tie: true })]),
      // 增时线（含休止符后的增时线）不产生计划项
      makeBar([makeNote(5, 4), makeDash(), makeRest(4)]),
    ];
    const p = buildPlaybackPlan(score(bars));
    expect(sounding(p).map((n) => n.beats)).toEqual([1, 1, 2]);
    expect(p.filter((n) => n.kind === 'rest').map((n) => n.beats)).toEqual([1, 1]);
    // 计划项首尾相接，没有空隙
    for (let i = 1; i < p.length; i += 1) {
      expect(p[i].startBeat).toBeCloseTo(p[i - 1].startBeat + p[i - 1].beats);
    }
  });

  it('全休止的小节也有高亮项，播放不会跳过', () => {
    const p = buildPlaybackPlan(score([makeBar([makeRest(1)])]));
    expect(p.length).toBe(1);
    expect(p[0].kind).toBe('rest');
    expect(findPlanIndexAtBeat(p, 0.5)).toBe(0);
  });
});

describe('播放高亮：连音线期间逐音跟随', () => {
  const plan = buildPlaybackPlan(
    score([makeBar([makeNote(5, 4), makeNote(5, 4, { tie: true }), makeNote(1, 4)])]),
  );

  it('前半拍命中链首音符，后半拍命中连音线后续音符', () => {
    expect(findPlanIndexAtBeat(plan, 0.5)).toBe(0);
    expect(findPlanIndexAtBeat(plan, 1.5)).toBe(1);
    expect(plan[1].tied).toBe(true);
  });

  it('连音线结束后回到普通音符，超出全曲返回 -1', () => {
    expect(findPlanIndexAtBeat(plan, 2.5)).toBe(2);
    expect(findPlanIndexAtBeat(plan, 3)).toBe(-1);
  });
});

describe('前瞻调度：起播定位（firstSoundingIndex）', () => {
  // 拍位：0..1 是 1，1..2 是休止，2..4 是 5（二分），4..5 是 1
  const plan = buildPlaybackPlan(score([makeBar([makeNote(1, 4), makeRest(4), makeNote(5, 2), makeNote(1, 4)])]));
  const spb = 0.6; // ♩=100

  it('从 0 起播时从第一个计划项开始', () => {
    expect(firstSoundingIndex(plan, 0, spb)).toBe(0);
  });

  it('起播点落在休止符里时跳过已经结束的项', () => {
    expect(firstSoundingIndex(plan, 0.9, spb)).toBe(1); // 1.5 拍
  });

  it('起播点落在长音中间时从那一项开始（该音从头重放，与旧版 endSec<=from 的判定一致）', () => {
    expect(firstSoundingIndex(plan, 1.8, spb)).toBe(2); // 3 拍，落在 2..4 这一项里
  });

  it('起播点正好卡在项的结束拍上时跳过它（不留半个音）', () => {
    expect(firstSoundingIndex(plan, 4 * spb, spb)).toBe(3); // 4 拍 = 第 2 项结束
  });

  it('起播点超过全曲时返回 plan.length：不发出任何声音', () => {
    expect(firstSoundingIndex(plan, 5 * spb, spb)).toBe(plan.length);
  });

  it('起播点为负 / 非法时退回 0（不能把 nextIndex 排到负数，那样会漏排整段）', () => {
    expect(firstSoundingIndex(plan, -1, spb)).toBe(0);
    expect(firstSoundingIndex(plan, Number.NaN, spb)).toBe(0);
    expect(firstSoundingIndex(plan, 1, 0)).toBe(0);
  });
});

describe('前瞻调度：发声判定（isPlayableNote）', () => {
  const plan = buildPlaybackPlan(
    score([makeBar([makeNote(5, 4), makeNote(5, 4, { tie: true }), makeRest(4), makeNote(1, 4)])]),
  );

  it('链首发声，连音线后续音符与休止符项不建音频节点', () => {
    expect(isPlayableNote(plan[0])).toBe(true);
    expect(isPlayableNote(plan[1])).toBe(false); // tied
    expect(isPlayableNote(plan[2])).toBe(false); // rest
    expect(isPlayableNote(plan[3])).toBe(true);
  });

  it('degree 0（旧工程文件里写成音符的休止）算不出音高 → 不发声，NaN 不会进 AudioParam', () => {
    // Degree 类型是 1..7，旧工程文件里有把休止写成 degree 0 的音符，deserializeScore 不拦
    const legacy = score([makeBar([makeNote(0 as unknown as Degree, 4), makeNote(1, 4)])]);
    const p = buildPlaybackPlan(legacy);

    expect(Number.isNaN(p[0].midi)).toBe(true);
    expect(isPlayableNote(p[0])).toBe(false);
    expect(isPlayableNote(p[1])).toBe(true);
    // 它仍然进计划：高亮和总时长不受影响
    expect(findPlanIndexAtBeat(p, 0.5)).toBe(0);
  });
});
