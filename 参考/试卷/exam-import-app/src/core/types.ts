/** MinerU content_list.json 里的版面元素 */
export interface MineruElement {
  type: 'text' | 'image' | 'table' | 'equation' | string;
  text?: string;
  text_level?: number;
  img_path?: string;
  bbox?: number[];
  page_idx?: number;
  table_body?: string;
  table_caption?: string[];
  table_footnote?: string[];
  image_caption?: string[];
}

export type QuestionType = 'choice' | 'blank' | 'solution' | 'unknown';
export type QuestionStatus = 'pending' | 'reviewed' | 'confirmed';

export interface Figure {
  type: 'image' | 'table';
  imgPath: string;
  bbox: number[];
  page: number;
  caption: string[];
  tableBody?: string;
}

export interface QuestionOption {
  label: string;
  content: string;
}

export interface Question {
  id: string;
  number: string;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  subquestions: string[];
  figures: Figure[];
  page: number;
  bbox: number[];
  warnings: string[];
  status: QuestionStatus;
}

export interface Section {
  title: string;
  questions: Question[];
}

export interface LooseBlock {
  type: 'text' | 'image' | 'table';
  text?: string;
  imgPath?: string;
  bbox?: number[];
  page?: number;
  tableBody?: string;
  caption?: string[];
}

export interface ParsedExam {
  examTitle: string | null;
  preamble: string[];
  sections: Section[];
  looseBlocks: LooseBlock[];
}

export const TYPE_LABEL: Record<QuestionType, string> = {
  choice: '选择题',
  blank: '填空题',
  solution: '解答题',
  unknown: '未识别',
};

export const STATUS_LABEL: Record<QuestionStatus, string> = {
  pending: '待校对',
  reviewed: '已核对',
  confirmed: '已确认',
};
