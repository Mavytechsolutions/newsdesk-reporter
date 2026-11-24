import { Transform, Type } from 'class-transformer';

const toBool = () => Transform(({ value }) => value === true || value === 'true' || value === '1');
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUrl, Matches,
  IsUUID, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { WORKFLOW, WorkflowAction } from './workflow';

export class TranslationDto {
  @IsIn(['te', 'en']) language: 'te' | 'en';
  @IsString() @MinLength(5) @MaxLength(160) headline: string;
  @IsString() @MinLength(10) @MaxLength(1200) summary: string;
  @IsString() @MinLength(10) @MaxLength(50000) body: string;
}

export class CreateArticleDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => TranslationDto) translations: TranslationDto[];
  @IsUUID() categoryId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true }) locationIds: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(15) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsBoolean() isBreaking?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsIn(['STAFF', 'AGENCY', 'AI_ASSISTED', 'CITIZEN']) sourceType?: 'STAFF' | 'AGENCY' | 'AI_ASSISTED' | 'CITIZEN';
  @IsOptional() @IsString() @MaxLength(120) sourceName?: string;
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_tld: false }) heroImageUrl?: string;
  @IsOptional() @IsString() @MaxLength(120) heroImageCredit?: string;
  @IsOptional() @IsISO8601() scheduledAt?: string;
}

export class UpdateArticleDto {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => TranslationDto) translations?: TranslationDto[];
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true }) locationIds?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(15) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsBoolean() isBreaking?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsString() @MaxLength(120) sourceName?: string;
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_tld: false }) heroImageUrl?: string;
  @IsOptional() @IsString() @MaxLength(120) heroImageCredit?: string;
  @IsOptional() @IsISO8601() scheduledAt?: string | null;
  /** Required when editing an already-published story — shown to readers as a correction note. */
  @IsOptional() @IsString() @MaxLength(500) correctionNote?: string;
}

export class TransitionDto {
  @IsIn(Object.keys(WORKFLOW)) action: WorkflowAction;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class PublicListQuery {
  @IsOptional() @IsString() category?: string; // slug
  @IsOptional() @IsUUID() locationId?: string; // includes all places inside it
  @IsOptional() @toBool() @IsBoolean() breaking?: boolean;
  @IsOptional() @IsIn(['te', 'en']) lang?: 'te' | 'en';
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class NewsroomListQuery {
  @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'REJECTED', 'ARCHIVED'])
  status?: string;
  @IsOptional() @toBool() @IsBoolean() mine?: boolean;
  /** 'journalist' = stories sent from the app by citizen journalists; 'staff' = newsroom stories */
  @IsOptional() @IsIn(['journalist', 'staff']) source?: 'journalist' | 'staff';
  /** comma-separated statuses, e.g. SUBMITTED,IN_REVIEW (used by the admin review queue) */
  @IsOptional() @Matches(/^[A-Z_]+(,[A-Z_]+){0,8}$/) statuses?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
