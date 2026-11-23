import {
  Button,
  Caption1,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  Subtitle2,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import type { Evidence } from '@process-flow/domain';
import { useEvidenceFiles, useWorkflow } from '@process-flow/react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/useI18n';
import { DOCUMENT_MESSAGES } from '../i18n/documentMessages';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM, minWidth: 0 },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingBottom: tokens.spacingVerticalM,
    overflowWrap: 'anywhere',
  },
  row: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalS, alignItems: 'center' },
  muted: { color: tokens.colorNeutralForeground3 },
  file: { maxWidth: '100%' },
});

export function EvidenceEditor({
  evidence,
  readOnly,
  onChange,
  onBusyChange,
}: {
  evidence: readonly Evidence[];
  readOnly: boolean;
  onChange?: (items: readonly Evidence[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const styles = useStyles();
  const { locale } = useI18n();
  const m = DOCUMENT_MESSAGES[locale];
  const files = useEvidenceFiles();
  const { state } = useWorkflow();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const mounted = useRef(true);
  const notifyBusy = useRef(onBusyChange);
  const counter = useRef(0);
  useEffect(() => {
    notifyBusy.current = onBusyChange;
  }, [onBusyChange]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      notifyBusy.current?.(false);
    };
  }, []);
  const locked = readOnly || reading;
  const nextId = () => {
    if (files) return files.createId();
    let id: string;
    do {
      id = `link-${++counter.current}`;
    } while (evidence.some((item) => item.id === id));
    return id;
  };
  const appendLink = () => {
    if (locked) return;
    try {
      const parsed = new URL(url);
      if (
        !title.trim() ||
        !['https:', 'http:'].includes(parsed.protocol) ||
        !parsed.hostname ||
        parsed.username ||
        parsed.password
      )
        throw new Error();
      if (evidence.length >= 20) {
        setError(m.limitError);
        return;
      }
      onChange?.([
        ...evidence,
        { id: nextId(), kind: 'link', title: title.trim(), description: description.trim(), url: parsed.href },
      ]);
      setTitle('');
      setDescription('');
      setUrl('');
      setError('');
    } catch {
      setError(m.invalidLink);
    }
  };
  const addFiles = async (selected: readonly File[]) => {
    if (!files || locked || selected.length === 0) return;
    const total = Object.values(state.records)
      .flatMap((r) => r.evidence ?? [])
      .reduce((sum, item) => sum + (item.kind === 'file' ? (item.size ?? 0) : 0), 0);
    if (
      evidence.length + selected.length > 20 ||
      selected.some((f) => f.size > 2 * 1024 * 1024) ||
      total + selected.reduce((sum, f) => sum + f.size, 0) > 8 * 1024 * 1024
    ) {
      setError(m.limitError);
      return;
    }
    setReading(true);
    onBusyChange?.(true);
    setError('');
    try {
      const added = await Promise.all(
        selected.map(async (file) => ({
          ...(await files.read(file)),
          id: files.createId(),
          kind: 'file' as const,
          title: title.trim() || file.name,
          description: description.trim(),
        })),
      );
      if (mounted.current) {
        onChange?.([...evidence, ...added]);
        setTitle('');
        setDescription('');
      }
    } catch {
      if (mounted.current) setError(m.readError);
    } finally {
      if (mounted.current) {
        setReading(false);
        onBusyChange?.(false);
      }
    }
  };
  return (
    <section className={styles.root} aria-label={m.evidence}>
      <Subtitle2 as="h3">{m.evidence}</Subtitle2>
      <Caption1 className={styles.muted}>{m.evidenceHint}</Caption1>
      {evidence.length === 0 && <Caption1>{m.noEvidence}</Caption1>}
      {evidence.map((item, index) => (
        <div key={item.id} className={styles.item}>
          {readOnly ? (
            <>
              <strong>{item.title}</strong>
              {item.description && <p>{item.description}</p>}
            </>
          ) : (
            <>
              <Field label={`${m.evidenceTitle} ${index + 1}`} required>
                <Input
                  value={item.title}
                  disabled={locked}
                  maxLength={200}
                  onChange={(_, data) =>
                    onChange?.(evidence.map((e, i) => (i === index ? { ...e, title: data.value } : e)))
                  }
                />
              </Field>
              <Field label={`${m.description} ${index + 1}`}>
                <Textarea
                  value={item.description}
                  disabled={locked}
                  maxLength={2000}
                  onChange={(_, data) =>
                    onChange?.(evidence.map((e, i) => (i === index ? { ...e, description: data.value } : e)))
                  }
                />
              </Field>
            </>
          )}
          <div className={styles.row}>
            {item.kind === 'link' && item.url && /^https?:\/\//i.test(item.url) && (
              <Link href={item.url} target="_blank" rel="noopener noreferrer">
                {item.url}
              </Link>
            )}
            {item.kind === 'file' && (
              <Button
                disabled={!files || item.base64 === undefined || !item.fileName}
                onClick={() => {
                  if (files && item.base64 !== undefined && item.fileName)
                    files.download({
                      fileName: item.fileName,
                      mediaType: item.mediaType ?? 'application/octet-stream',
                      base64: item.base64,
                    });
                }}
              >
                {item.fileName} · {m.download}
              </Button>
            )}
            {!readOnly && (
              <Button
                disabled={locked}
                onClick={() => onChange?.(evidence.filter((_, i) => i !== index))}
                aria-label={`${item.title} ${m.remove}`}
              >
                {m.remove}
              </Button>
            )}
          </div>
        </div>
      ))}
      {!readOnly && (
        <>
          <Field label={m.evidenceTitle}>
            <Input value={title} maxLength={200} disabled={locked} onChange={(_, d) => setTitle(d.value)} />
          </Field>
          <Field label={m.description}>
            <Textarea
              value={description}
              maxLength={2000}
              disabled={locked}
              onChange={(_, d) => setDescription(d.value)}
            />
          </Field>
          <Field label={m.url}>
            <Input
              type="url"
              value={url}
              placeholder="https://"
              disabled={locked}
              maxLength={2048}
              onChange={(_, d) => setUrl(d.value)}
            />
          </Field>
          <div>
            <Button disabled={locked} onClick={appendLink}>
              {m.addLink}
            </Button>
          </div>
          <label>
            {m.files}
            <input
              className={styles.file}
              aria-label={m.files}
              type="file"
              multiple
              disabled={locked || !files}
              onChange={(event) => {
                const selected = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                void addFiles(selected);
              }}
            />
          </label>
          <Caption1 className={styles.muted}>{m.limits}</Caption1>
          {!files && <Caption1>{m.fileUnavailable}</Caption1>}
        </>
      )}
      {reading && <Caption1 role="status">{m.reading}</Caption1>}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </section>
  );
}
