/**
 * 专业 / 汇报模板（模板库「专业模板」标签页内容）：
 * 面向中学数学教研组长、备课组长的述职与工作汇报。
 *
 * 纪律与数学讲义模板一致：
 * 1. build() 一律返回「扁平 SlideElement[]」；整套模板的每页元素同样保持扁平。
 * 2. 版式全部走 pptLayouts，只用槽位填内容，保证每页栅格一致。
 * 3. 页眉只传 eyebrow（header() 左右两个文本框在 x 轴上有重叠区，同时传会压字）。
 * 4. 汇报页没有公式，数值与比例直接写在正文里；文案短句、克制，不写空话。
 */
import type { SlideElement } from '@/types'
import { getTheme } from './pptTheme'
import { bullets, chart, cover, end, imageRight, section, timeline, toc, twoCol } from './pptLayouts'

export const PPT_FONT_TITLE = 'hei-bold'
export const PPT_FONT_BODY = 'sans'
export const PPT = {
  bg: '#FFFFFF',
  text: '#1F1F1F',
  light: '#595959',
  accent: '#4472C4',
  accentDark: '#2F5597',
  divider: '#D9D9D9',
  footer: '#8C8C8C',
}

export interface ProTemplate { id: string; name: string; cat: string; build(): SlideElement[] }

const t = getTheme('office')
const BG = t.bg

export const proTemplates: ProTemplate[] = [
  // ── 封面 ────────────────────────────────────────────────────────────────
  {
    id: 'ppt-cover', name: '封面 · 述职主标题', cat: '封面',
    build() {
      return cover(t, {
        title: '数学备课组\n工作述职',
        subtitle: '2024 — 2025 学年第二学期',
        author: '汇报人 · 高二数学备课组',
        unit: 'XX 中学 · 教学处',
        date: '2025 · 07',
      })
    },
  },

  // ── 目录 ────────────────────────────────────────────────────────────────
  {
    id: 'ppt-toc', name: '目录 · 述职五段', cat: '目录',
    build() {
      return toc(t, {
        eyebrow: '备课组述职 · 高二数学',
        pageNum: '02',
        items: [
          { no: '01', title: '工作回顾：计划落实与常规教学', page: '03' },
          { no: '02', title: '重点突破：集体备课与课例研讨', page: '05' },
          { no: '03', title: '数据看成绩：均分、优秀率与达标率', page: '07' },
          { no: '04', title: '问题与不足：从课堂到作业', page: '09' },
          { no: '05', title: '下学期工作思路与安排', page: '11' },
        ],
      })
    },
  },

  // ── 章节 ────────────────────────────────────────────────────────────────
  {
    id: 'ppt-section', name: '章节 · 工作回顾', cat: '章节',
    build() {
      return section(t, { no: '01', title: '工作回顾', subtitle: '计划落实 · 常规教学 · 集体备课' })
    },
  },
  {
    id: 'ppt-section-2', name: '章节 · 问题与改进', cat: '章节',
    build() {
      return section(t, { no: '02', title: '问题与改进', subtitle: '从课堂观察到作业反馈' })
    },
  },

  // ── 图文 ────────────────────────────────────────────────────────────────
  {
    id: 'ppt-list', name: '图文 · 重点工作列表', cat: '图文',
    build() {
      return bullets(t, {
        eyebrow: '备课组工作述职',
        pageNum: '03',
        title: '本学期重点工作',
        bullets: [
          { lead: '集体备课常态化', support: '每周三下午两节课，主备人说课、组内讨论、修改定稿。' },
          { lead: '作业设计与批改', support: '统一作业量，全批全改与面批结合，每单元一次错题复盘。' },
          { lead: '课例研讨', support: '每位教师每学期一节组内公开课，课后 20 分钟内完成评课记录。' },
          { lead: '培优与补差', support: '年级前 60 名学生每周一次专题辅导，后进生一对一订正跟踪。' },
          { lead: '资料建设', support: '完成一轮复习学案 12 个专题、配套课时练习 36 份，统一归档。' },
        ],
        aside: {
          title: '本学期数据',
          lines: ['集体备课 18 次', '组内公开课 9 节', '专题学案 12 个', '课时练习 36 份'],
        },
      })
    },
  },
  {
    id: 'ppt-image', name: '图文 · 教研活动留影', cat: '图文',
    build() {
      return imageRight(t, {
        eyebrow: '备课组工作述职',
        pageNum: '04',
        title: '课堂教学与教研活动',
        lines: [
          '本学期组内听课 42 节，每节课记录不少于 3 条改进意见。',
          '公开课选题集中在函数与导数、立体几何两个难点章节。',
          '课堂观察聚焦三个维度：目标达成、学生参与、例题梯度。',
          '课后统一使用同一张评课表，两周后回看改进落实情况。',
        ],
        caption: '图：组内公开课课堂观察记录（可替换为活动照片）',
      })
    },
  },

  // ── 数据 ────────────────────────────────────────────────────────────────
  {
    id: 'ppt-chart', name: '数据 · 期末均分对比', cat: '数据',
    build() {
      return chart(t, {
        eyebrow: '备课组工作述职',
        pageNum: '07',
        title: '数据看成绩 · 期末数学均分',
        chartTitle: '期末数学均分（分）',
        bars: [
          { label: '高一', value: 78.5 },
          { label: '高二', value: 81.2 },
          { label: '高三', value: 76.4 },
        ],
        lines: [
          '高二年级较期中提高 2.6 分，主要来自解析几何专题的强化训练。',
          '高三年级与市均分差值为正，试卷难度提升后仍保持稳定。',
          '优秀率（120 分以上）由 21.4% 提升到 24.8%。',
        ],
      })
    },
  },
  {
    id: 'ppt-kpi', name: '数据 · 三项核心指标', cat: '数据',
    build() {
      return twoCol(t, {
        eyebrow: '备课组工作述职',
        pageNum: '08',
        title: '三项核心指标',
        left: {
          title: '期末成绩',
          lines: [
            '高二期末均分 81.2 分，较上学期提高 2.6 分。',
            '120 分以上占 24.8%，较上学期提高 3.4 个百分点。',
          ],
        },
        right: {
          title: '达标情况',
          lines: [
            '90 分以上占 86.5%，连续两个学期上升。',
            '各班达标率差距控制在 8 个百分点以内。',
          ],
        },
      })
    },
  },

  // ── 时间轴 ──────────────────────────────────────────────────────────────
  {
    id: 'ppt-timeline', name: '时间轴 · 本学期节点', cat: '时间轴',
    build() {
      return timeline(t, {
        eyebrow: '备课组工作述职',
        pageNum: '05',
        title: '本学期工作节点',
        nodes: [
          { time: '2 月', label: '制定学期计划，统一进度与作业量' },
          { time: '3 月', label: '第一轮组内公开课：函数与导数' },
          { time: '4 月', label: '期中质量分析，调整分层辅导名单' },
          { time: '5 月', label: '第二轮组内公开课：立体几何' },
          { time: '6 月', label: '期末命题与复习学案定稿' },
        ],
      })
    },
  },
  {
    id: 'ppt-plan', name: '时间轴 · 下学期安排', cat: '时间轴',
    build() {
      return timeline(t, {
        eyebrow: '备课组工作述职',
        pageNum: '11',
        title: '下学期工作安排',
        nodes: [
          { time: '8 月', label: '开学前完成一轮复习学案修订' },
          { time: '9 月', label: '确定专题顺序，落实双周诊断' },
          { time: '10 月', label: '青年教师说题比赛与组内磨课' },
          { time: '11 月', label: '期中质量分析，调整分层名单' },
          { time: '12 月', label: '专题复习收尾，期末命题' },
        ],
      })
    },
  },

  // ── 两栏 ────────────────────────────────────────────────────────────────
  {
    id: 'ppt-two', name: '两栏 · 成绩与不足', cat: '两栏',
    build() {
      return twoCol(t, {
        eyebrow: '备课组工作述职',
        pageNum: '09',
        title: '成绩与不足',
        left: {
          title: '本学期成绩',
          lines: [
            '教学进度统一，各班课时差不超过 2 节。',
            '期中、期末两次统考均分均高于年级平均。',
            '学案与练习统一编排，新教师可直接使用。',
            '听课评课留有记录，改进意见可追溯。',
          ],
        },
        right: {
          title: '存在的问题',
          lines: [
            '课堂容量偏大，留给学生板演的时间不足。',
            '作业分层不够细，后进生完成率约 78%。',
            '部分专题例题梯度不明显，缺少台阶。',
            '青年教师独立命题的机会偏少。',
          ],
        },
      })
    },
  },
  {
    id: 'ppt-compare', name: '两栏 · 做法与调整', cat: '两栏',
    build() {
      return twoCol(t, {
        eyebrow: '备课组工作述职',
        pageNum: '10',
        title: '一轮复习：本学期做法与下学期调整',
        left: {
          title: '本学期做法',
          lines: [
            '按教材顺序推进，每章配一份诊断卷。',
            '每周一次错题重做，组内统一筛选。',
            '薄弱班级每周增加一节答疑课。',
            '月考后固定召开一次质量分析会。',
          ],
        },
        right: {
          title: '下学期调整',
          lines: [
            '改为按专题重组，先函数后几何。',
            '诊断卷改为双周一次，限时 40 分钟。',
            '错题重做改为分层布置，加一道变式。',
            '增加青年教师命题与说题训练。',
          ],
        },
      })
    },
  },

  // ── 结尾 ────────────────────────────────────────────────────────────────
  {
    id: 'ppt-end', name: '结尾 · 述职收束页', cat: '结尾',
    build() {
      return end(t, {
        title: '敬请批评指正',
        lines: ['高二数学备课组 · 2025 年 7 月', '汇报数据来自本学期期中、期末统考成绩统计'],
      })
    },
  },
]

export function findProTemplate(id: string): ProTemplate | undefined {
  return proTemplates.find((x) => x.id === id)
}

export interface ProSlide { elements: SlideElement[]; bg: string }
export interface ProBundle { id: string; name: string; description: string; slides: ProSlide[] }

function slide(elements: SlideElement[]): ProSlide {
  return { elements, bg: BG }
}

export const proBundles: ProBundle[] = [
  {
    id: 'pro-bundle-report',
    name: '备课组工作述职（整套）',
    description: '7 页：封面 · 目录 · 重点工作 · 教研活动 · 期末数据 · 工作节点 · 结尾',
    slides: [
      slide(cover(t, {
        title: '数学备课组\n工作述职',
        subtitle: '2024 — 2025 学年第二学期',
        author: '汇报人 · 高二数学备课组',
        unit: 'XX 中学 · 教学处',
        date: '2025 · 07',
      })),
      slide(toc(t, {
        eyebrow: '备课组述职 · 高二数学',
        pageNum: '02',
        items: [
          { no: '01', title: '本学期重点工作', page: '03' },
          { no: '02', title: '课堂教学与教研活动', page: '04' },
          { no: '03', title: '数据看成绩', page: '05' },
          { no: '04', title: '本学期工作节点', page: '06' },
          { no: '05', title: '下学期工作思路', page: '07' },
        ],
      })),
      slide(bullets(t, {
        eyebrow: '备课组工作述职',
        pageNum: '03',
        title: '本学期重点工作',
        bullets: [
          { lead: '集体备课常态化', support: '每周三下午两节课，主备人说课、组内讨论、修改定稿。' },
          { lead: '作业设计与批改', support: '统一作业量，全批全改与面批结合，每单元一次错题复盘。' },
          { lead: '课例研讨', support: '每位教师每学期一节组内公开课，课后 20 分钟内完成评课记录。' },
          { lead: '培优与补差', support: '年级前 60 名学生每周一次专题辅导，后进生一对一订正跟踪。' },
          { lead: '资料建设', support: '完成一轮复习学案 12 个专题、配套课时练习 36 份，统一归档。' },
        ],
        aside: {
          title: '本学期数据',
          lines: ['集体备课 18 次', '组内公开课 9 节', '专题学案 12 个', '课时练习 36 份'],
        },
      })),
      slide(imageRight(t, {
        eyebrow: '备课组工作述职',
        pageNum: '04',
        title: '课堂教学与教研活动',
        lines: [
          '本学期组内听课 42 节，每节课记录不少于 3 条改进意见。',
          '公开课选题集中在函数与导数、立体几何两个难点章节。',
          '课堂观察聚焦三个维度：目标达成、学生参与、例题梯度。',
          '课后统一使用同一张评课表，两周后回看改进落实情况。',
        ],
        caption: '图：组内公开课课堂观察记录（可替换为活动照片）',
      })),
      slide(chart(t, {
        eyebrow: '备课组工作述职',
        pageNum: '05',
        title: '数据看成绩 · 期末数学均分',
        chartTitle: '期末数学均分（分）',
        bars: [
          { label: '高一', value: 78.5 },
          { label: '高二', value: 81.2 },
          { label: '高三', value: 76.4 },
        ],
        lines: [
          '高二年级较期中提高 2.6 分，主要来自解析几何专题的强化训练。',
          '高三年级与市均分差值为正，试卷难度提升后仍保持稳定。',
          '优秀率（120 分以上）由 21.4% 提升到 24.8%。',
        ],
      })),
      slide(timeline(t, {
        eyebrow: '备课组工作述职',
        pageNum: '06',
        title: '本学期工作节点',
        nodes: [
          { time: '2 月', label: '制定学期计划，统一进度与作业量' },
          { time: '3 月', label: '第一轮组内公开课：函数与导数' },
          { time: '4 月', label: '期中质量分析，调整分层辅导名单' },
          { time: '5 月', label: '第二轮组内公开课：立体几何' },
          { time: '6 月', label: '期末命题与复习学案定稿' },
        ],
      })),
      slide(end(t, {
        title: '敬请批评指正',
        lines: ['高二数学备课组 · 2025 年 7 月', '汇报数据来自本学期期中、期末统考成绩统计'],
      })),
    ],
  },
  {
    id: 'pro-bundle-plan',
    name: '教研组学期工作计划（整套）',
    description: '6 页：封面 · 目录 · 重点任务 · 逐月安排 · 保障措施 · 结尾',
    slides: [
      slide(cover(t, {
        title: '数学教研组\n学期工作计划',
        subtitle: '2025 — 2026 学年第一学期',
        author: '汇报人 · 数学教研组',
        unit: 'XX 中学 · 教学处',
        date: '2025 · 08',
      })),
      slide(toc(t, {
        eyebrow: '教研组计划 · 数学',
        pageNum: '02',
        items: [
          { no: '01', title: '本学期重点任务', page: '03' },
          { no: '02', title: '逐月工作安排', page: '04' },
          { no: '03', title: '保障措施与分工', page: '05' },
          { no: '04', title: '预期成果', page: '06' },
        ],
      })),
      slide(bullets(t, {
        eyebrow: '教研组学期工作计划',
        pageNum: '03',
        title: '本学期重点任务',
        bullets: [
          { lead: '课堂教学改进', support: '以问题链设计为抓手，每月推出一节组内示范课。' },
          { lead: '命题研究', support: '建立双向细目表，期末试卷由两位教师独立命制后合并。' },
          { lead: '学情跟踪', support: '建立班级数学学情台账，月考后一周内完成数据分析。' },
          { lead: '青年教师培养', support: '师徒结对，每学期完成 10 节随堂听课与 2 次说题。' },
        ],
        aside: {
          title: '本学期目标',
          lines: ['示范课 8 节', '双向细目表 4 份', '学情台账 3 套', '师徒听课 60 节'],
        },
      })),
      slide(timeline(t, {
        eyebrow: '教研组学期工作计划',
        pageNum: '04',
        title: '逐月工作安排',
        nodes: [
          { time: '9 月', label: '开学摸底，确定各年级教学进度' },
          { time: '10 月', label: '问题链设计专题研讨与示范课' },
          { time: '11 月', label: '期中质量分析，修订分层方案' },
          { time: '12 月', label: '命题研究与双向细目表定稿' },
          { time: '1 月', label: '期末命题、阅卷与学期总结' },
        ],
      })),
      slide(twoCol(t, {
        eyebrow: '教研组学期工作计划',
        pageNum: '05',
        title: '保障措施与分工',
        left: {
          title: '保障措施',
          lines: [
            '每周固定两节课用于集体备课，不安排其他事务。',
            '学案、练习与试卷统一模板，由备课组长审核后归档。',
            '教研活动计入工作量，学期末按记录汇总反馈。',
          ],
        },
        right: {
          title: '分工安排',
          lines: [
            '备课组长：统筹进度、资料审核与质量把关。',
            '命题组：双向细目表制定与试卷命制。',
            '青年教师：说题、磨课与班级学情台账。',
          ],
        },
      })),
      slide(end(t, {
        title: '计划汇报完毕',
        lines: ['数学教研组 · 2025 年 8 月', '具体安排将根据教学处统一部署微调'],
      })),
    ],
  },
]

export function findProBundle(id: string): ProBundle | undefined {
  return proBundles.find((x) => x.id === id)
}
