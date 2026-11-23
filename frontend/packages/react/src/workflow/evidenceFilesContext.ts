import { createContext, useContext } from 'react';
import type { EvidenceFiles } from '@process-flow/application';

export const EvidenceFilesContext = createContext<EvidenceFiles | undefined>(undefined);
export const useEvidenceFiles = () => useContext(EvidenceFilesContext);
