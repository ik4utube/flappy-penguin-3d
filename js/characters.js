/* ==========================================================
 *  characters.js — 세계관 · 캐릭터 명단
 *
 *  stat 은 1~5. 게임 상수에 곱해질 배율로 환산된다.
 *  shape 는 penguin.js 가 읽는 외형 파라미터.
 * ========================================================== */

export const PROLOGUE = [
  '아주 오래전, 펭귄은 하늘을 날았다.',
  '바다가 넉넉해지자 펭귄들은 날개를 접고\n물속으로 내려갔다. 그리고 나는 법을 잊었다.',
  '그러나 긴 밤이 찾아왔다.\n빙원이 갈라지고, 물고기가 자취를 감췄다.',
  '남은 길은 하나뿐이다.\n다시 하늘로 오르는 것.',
  '날갯짓을 기억하라.',
];

export const CHARACTERS = [
  {
    id: 'parang',
    name: '파랑',
    roman: 'PARANG',
    title: '마지막 활공자',
    quote: '할아버지는 하늘을 봤다고 했다.',
    story:
      '아무도 그 말을 믿지 않았다. 파랑만이 매일 절벽에 올라 ' +
      '바람의 결을 외웠다. 물려받은 것이라고는 낡은 깃털 한 줌뿐이지만, ' +
      '그 깃털은 아직 바람을 안다.',
    stats: { speed: 3, turn: 3, lift: 3 },
    shape: {
      body: 0x35507e, belly: 0xf4f9ff, beak: 0xff9d3d, foot: 0xff9d3d,
      scale: 1.00, girth: 1.00, wing: 1.00, beakLen: 1.00, tail: 1.00,
      crest: null, brow: false,
    },
  },
  {
    id: 'nunbora',
    name: '눈보라',
    roman: 'NUNBORA',
    title: '흰 그림자',
    quote: '눈과 나를 구별한 건 바람뿐이었다.',
    story:
      '눈보라가 가장 사나웠던 밤에 알을 깼다. 온몸이 눈처럼 희어 ' +
      '무리 안에서도 자주 잊혔다. 대신 바람을 읽는 법을 익혔고, ' +
      '누구보다 높이 오른다. 다만 서두르는 법은 끝내 배우지 못했다.',
    stats: { speed: 2, turn: 3, lift: 5 },
    shape: {
      body: 0xeef4fb, belly: 0xffffff, beak: 0xffb3c1, foot: 0xffb3c1,
      eye: 0xd9455f,
      scale: 0.94, girth: 1.14, wing: 0.95, beakLen: 0.85, tail: 0.9,
      crest: null, brow: false,
    },
  },
  {
    id: 'geomeun',
    name: '검은바위',
    roman: 'GEOMEUNBAWI',
    title: '절벽의 다이버',
    quote: '떨어지는 법은 안다. 오르는 법만 남았다.',
    story:
      '가장 높은 검은 바위에서 뛰어내리기를 멈추지 않았다. ' +
      '부리가 깨지고 날개가 접혔지만 한 번도 울지 않았다. ' +
      '내려가는 속도만큼은 어떤 펭귄도 따라오지 못한다.',
    stats: { speed: 5, turn: 2, lift: 2 },
    shape: {
      body: 0x1d2130, belly: 0xc9d3e0, beak: 0x4a5162, foot: 0x6b7383,
      scale: 1.10, girth: 0.92, wing: 1.10, beakLen: 1.15, tail: 1.25,
      crest: null, brow: true,
    },
  },
  {
    id: 'norang',
    name: '노랑볏',
    roman: 'NORANGBYEOT',
    title: '바람의 무희',
    quote: '똑바로 가는 건 재미가 없잖아.',
    story:
      '마카로니 무리에서도 유난히 시끄러웠다. 노래하듯 울고 ' +
      '춤추듯 난다. 좁은 골짜기를 스치듯 빠져나가는 재주는 ' +
      '장난처럼 익힌 것이지만, 지금은 그 재주가 무리를 살린다.',
    stats: { speed: 3, turn: 5, lift: 2 },
    shape: {
      body: 0x2a2f42, belly: 0xfdfbf2, beak: 0xff8a2b, foot: 0xffb03a,
      scale: 0.97, girth: 0.90, wing: 1.05, beakLen: 1.05, tail: 0.95,
      crest: 0xffd94a, brow: false,
    },
  },
  {
    id: 'juhwang',
    name: '주황발',
    roman: 'JUHWANGBAL',
    title: '얼음 위의 질주자',
    quote: '물속에서 제일 빨랐다. 하늘이라고 다를까.',
    story:
      '젠투의 후예. 얼음판을 배로 미끄러져 내려가는 속도로 ' +
      '이름을 얻었다. 하늘에서도 같은 자세를 고집하다 여러 번 ' +
      '곤두박질쳤지만, 고집을 꺾을 생각은 없어 보인다.',
    stats: { speed: 4, turn: 4, lift: 1 },
    shape: {
      body: 0x1f4a52, belly: 0xf2fbff, beak: 0xff4d3d, foot: 0xff4d3d,
      scale: 1.04, girth: 0.96, wing: 1.18, beakLen: 1.10, tail: 1.05,
      crest: null, brow: false,
    },
  },
  {
    id: 'eunbit',
    name: '은빛',
    roman: 'EUNBIT',
    title: '긴 밤의 끝',
    quote: '……',
    story:
      '빙원의 오래된 이야기에만 나오던 펭귄. 긴 밤이 시작되던 날 ' +
      '무리 앞에 나타나 한마디도 없이 북쪽 하늘을 가리켰다. ' +
      '그 방향으로 날아간 자는 아직 아무도 돌아오지 않았다.',
    stats: { speed: 4, turn: 4, lift: 4 },
    shape: {
      body: 0x6b6f8c, belly: 0xe8e6f5, beak: 0xe8c261, foot: 0xe8c261,
      eye: 0xf0d878,
      scale: 1.02, girth: 0.98, wing: 1.12, beakLen: 1.0, tail: 1.15,
      crest: 0xd8d2ea, brow: true,
    },
  },
];

/** stat(1~5) → 게임 상수에 곱할 배율 */
export function statMul(stat) {
  return 0.82 + stat * 0.07;   // 1 → 0.89,  3 → 1.03,  5 → 1.17
}

export function findCharacter(id) {
  return CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
}
