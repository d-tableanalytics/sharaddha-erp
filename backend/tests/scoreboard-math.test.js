import test from 'node:test';
import assert from 'node:assert/strict';

test('Executive Scoreboard — Mathematical Engine & Scoring Logic', async (t) => {
  await t.test('calculates miss percentage correctly against 0% benchmark', () => {
    // Zero misses
    const planned1 = 12;
    const actual1 = 12;
    const miss1 = Math.round(((planned1 - actual1) / planned1) * 100);
    assert.equal(miss1, 0);

    // 1 miss out of 12
    const planned2 = 12;
    const actual2 = 11;
    const miss2 = Math.round(((planned2 - actual2) / planned2) * 100);
    assert.equal(miss2, 8); // 1/12 = 8.333% -> 8%

    // 1 miss out of 5
    const planned3 = 5;
    const actual3 = 4;
    const miss3 = Math.round(((planned3 - actual3) / planned3) * 100);
    assert.equal(miss3, 20); // 1/5 = 20%
  });

  await t.test('calculates baseline score as inverted mean of KRA misses', () => {
    // Example from doc: Rahul Sharma (0% done miss, 8% on-time miss)
    const missDone = 0;
    const missOnTime = 8;
    const scoreDone = Math.max(0, 100 - missDone);
    const scoreOnTime = Math.max(0, 100 - missOnTime);
    const baselineScore = Math.round((scoreDone + scoreOnTime) / 2);
    assert.equal(baselineScore, 96);

    // With MD Adjustment of +1
    const mdAdj = 1;
    const finalScore = Math.max(0, baselineScore + mdAdj);
    assert.equal(finalScore, 97);
  });

  await t.test('strictly sorts by 3-level comparator: hasWork > finalScore > alphabetical', () => {
    const rows = [
      { doer: 'Zara Zero', hasWork: false, finalScore: null },
      { doer: 'Vikram Rao', hasWork: true, finalScore: 80 },
      { doer: 'Amit Patel', hasWork: true, finalScore: 96 },
      { doer: 'Rahul Sharma', hasWork: true, finalScore: 96 },
      { doer: 'Bob Zero', hasWork: false, finalScore: null },
      { doer: 'Arun Kumar', hasWork: true, finalScore: 100 },
    ];

    rows.sort((a, b) => {
      if (a.hasWork !== b.hasWork) {
        return a.hasWork ? -1 : 1;
      }
      const scoreA = a.finalScore !== null ? a.finalScore : -999;
      const scoreB = b.finalScore !== null ? b.finalScore : -999;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return a.doer.localeCompare(b.doer);
    });

    const namesInOrder = rows.map((r) => r.doer);
    assert.deepEqual(namesInOrder, [
      'Arun Kumar',   // 100
      'Amit Patel',   // 96, alphabetical before Rahul
      'Rahul Sharma', // 96
      'Vikram Rao',   // 80
      'Bob Zero',     // No work, alphabetical before Zara
      'Zara Zero',    // No work
    ]);

    // Top 3 with work
    const top3 = rows.filter((r) => r.hasWork && r.finalScore !== null).slice(0, 3);
    assert.equal(top3.length, 3);
    assert.equal(top3[0].doer, 'Arun Kumar');
    assert.equal(top3[1].doer, 'Amit Patel');
    assert.equal(top3[2].doer, 'Rahul Sharma');
  });
});
