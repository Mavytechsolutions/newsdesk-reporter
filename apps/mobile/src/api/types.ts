export type Lang = 'te' | 'en';

export interface Place {
  id: string;
  type: string;
  nameEn: string;
  nameTe: string;
}

export interface Category {
  id: string;
  slug: string;
  nameEn: string;
  nameTe: string;
  isVirtual: boolean;
}

export interface ArticleCard {
  id: string;
  slug: string;
  language: Lang;
  availableLanguages: Lang[];
  headline: string;
  summary: string;
  body?: string;
  tags?: string[];
  category: { slug: string; nameEn: string; nameTe: string };
  locations: Place[];
  reporter: string | null;
  sourceType: 'STAFF' | 'CITIZEN' | 'AGENCY' | 'AI_ASSISTED';
  sourceLabel: string;
  isBreaking: boolean;
  isFeatured: boolean;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  shareCount: number;
  heroImageUrl: string | null;
  heroImageCredit: string | null;
  publishedAt: string;
  updatedAt: string;
  shareUrl: string;
  liked?: boolean;
  disliked?: boolean;
  bookmarked?: boolean;
  related?: ArticleCard[];
}

export interface Page {
  items: ArticleCard[];
  nextCursor: string | null;
  total?: number;
  needsLocation?: boolean;
  didYouMean?: string | null;
}

export interface Me {
  id: string;
  phone: string | null;
  name: string | null;
  language: Lang;
  locations: (Place & { isPrimary: boolean })[];
  categories: Category[];
}

export interface Comment {
  id: string;
  body: string;
  author: string;
  createdAt: string;
  mine: boolean;
}
