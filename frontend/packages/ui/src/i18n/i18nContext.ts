import type { Locale, ProcessText } from '@process-flow/domain';
import { createContext } from 'react';

export type ProcessTextCatalog = Readonly<Record<Locale, ProcessText>>;

export const ProcessTextContext = createContext<ProcessTextCatalog | null>(null);
