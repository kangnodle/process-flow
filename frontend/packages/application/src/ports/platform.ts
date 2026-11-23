import type { Locale, ResolvedMode } from '@process-flow/domain';
import type { AuthRepository } from './authRepository';
import type { ProjectRepository } from './projectRepository';
import type { UserRepository } from './userRepository';
import type { WorkflowRepository } from './workflowRepository';
import type { WorkRepository } from './workRepository';

export interface ColorSchemeSource {
  current(): ResolvedMode;
  subscribe(listener: () => void): () => void;
}

export interface CompactTaskLayoutSource {
  current(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface DocumentSurface {
  setLanguage(locale: Locale): void;
  setTitle(title: string): void;
}

export interface Scheduler {
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface Navigation {
  current(): string;
  push(path: string): void;
  replace(path: string): void;
  back(): boolean;
  subscribe(listener: () => void): () => void;
}

export interface Platform {
  readonly evidenceFiles?: EvidenceFiles;
  readonly authRepository?: AuthRepository;
  readonly workflowRepository?: WorkflowRepository;
  readonly projectRepository?: ProjectRepository;
  readonly userRepository?: UserRepository;
  readonly workRepository?: WorkRepository;
  readonly guardUnsaved?: (isUnsaved: () => boolean) => () => void;
  readonly navigation?: Navigation;
  readonly scheduler: Scheduler;
  readonly colorScheme: ColorSchemeSource;
  readonly compactTaskLayout?: CompactTaskLayoutSource;
  readonly document: DocumentSurface;
  readonly preferredLanguages: readonly string[];
}

export interface EvidenceFileInput {
  readonly name: string;
  readonly type: string;
  readonly size: number;
}
export interface EvidenceFileData {
  readonly fileName: string;
  readonly mediaType: string;
  readonly size: number;
  readonly base64: string;
}
export interface EvidenceFiles {
  read(file: EvidenceFileInput): Promise<EvidenceFileData>;
  download(file: Pick<EvidenceFileData, 'fileName' | 'mediaType' | 'base64'>): void;
  createId(): string;
}
