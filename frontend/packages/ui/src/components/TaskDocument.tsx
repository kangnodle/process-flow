import {
  Badge,
  Card,
  Caption1,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Select,
  Subtitle2,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  getRecord,
  taskForm,
  validateTaskDocument,
  type TaskId,
  type TaskRecord,
  type TaskDocument as DocumentValue,
} from '@process-flow/domain';
import { memo } from 'react';
import { useWorkflow, useWorkflowSelector } from '@process-flow/react';
import { useI18n } from '../i18n/useI18n';
import { DOCUMENT_MESSAGES } from '../i18n/documentMessages';
import { EvidenceEditor } from './EvidenceEditor';

const useStyles = makeStyles({
  document: { gap: tokens.spacingVerticalXL },
  row: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalM,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  content: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 },
  fields: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function TaskDocument({
  taskId,
  readOnly,
  done,
  onBusyChange,
}: {
  taskId: TaskId;
  readOnly: boolean;
  done: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { state, dispatch } = useWorkflow();
  const { locale, t } = useI18n();
  const m = DOCUMENT_MESSAGES[locale];
  const styles = useStyles();
  const record = getRecord(state, taskId);
  const form = taskForm(taskId);
  const document = record.document ?? { version: 1, answers: {}, reviewStatus: 'pending' };
  const invalid = validateTaskDocument(taskId, record);
  const filled = form.filter((f) => !invalid.includes(f.id)).length;
  const patch = (value: Partial<TaskRecord>) => dispatch({ type: 'updateRecord', taskId, patch: value });
  const updateAnswer = (id: string, value: string) =>
    patch({ document: { ...document, answers: { ...document.answers, [id]: value }, reviewStatus: 'pending' } });
  return (
    <Card size="large" className={styles.document} role="region" aria-label={m.title}>
      <div className={styles.row}>
        <Subtitle2 as="h3">{m.title}</Subtitle2>
        <Badge appearance="tint" color={invalid.length === 0 ? 'success' : 'informative'}>
          {invalid.length === 0 ? m.ready : m.draft}
        </Badge>
      </div>
      {done && (
        <MessageBar intent={invalid.length ? 'warning' : 'info'}>
          <MessageBarBody>{invalid.length ? m.legacy : m.frozen}</MessageBarBody>
        </MessageBar>
      )}
      <div>
        <Caption1>{m.count(filled, form.length)}</Caption1>
        <ProgressBar value={form.length ? filled / form.length : 0} aria-label={m.title} />
      </div>
      {form.map((field) => (
        <Field key={field.id} label={field.label[locale]} required hint={field.hint[locale]}>
          <Textarea
            rows={field.id.includes('scope') ? 3 : 4}
            resize="vertical"
            value={document.answers[field.id] ?? ''}
            disabled={readOnly}
            maxLength={10000}
            placeholder={field.hint[locale]}
            onChange={(_, data) => updateAnswer(field.id, data.value)}
          />
        </Field>
      ))}
      <Field label={m.review} required hint={m.reviewHint}>
        <Select
          value={document.reviewStatus}
          disabled={readOnly}
          onChange={(_, data) =>
            patch({ document: { ...document, reviewStatus: data.value as DocumentValue['reviewStatus'] } })
          }
        >
          <option value="pending">{m.pending}</option>
          <option value="passed">{m.passed}</option>
          <option value="blocked">{m.blocked}</option>
        </Select>
      </Field>
      <EvidenceEditor
        evidence={record.evidence ?? []}
        readOnly={readOnly}
        onBusyChange={onBusyChange}
        onChange={(evidence) => patch({ evidence, document: { ...document, reviewStatus: 'pending' } })}
      />
      <details>
        <summary>{m.additional}</summary>
        <div className={styles.fields}>
          <Field label={t.outputLink} hint={t.outputLinkHint}>
            <Input
              type="url"
              value={record.link}
              disabled={readOnly}
              onChange={(_, data) => patch({ link: data.value })}
            />
          </Field>
          <Field label={t.notes}>
            <Textarea
              rows={4}
              resize="vertical"
              value={record.note}
              disabled={readOnly}
              placeholder={t.notesPlaceholder}
              onChange={(_, data) => patch({ note: data.value })}
            />
          </Field>
        </div>
      </details>
      {invalid.length > 0 && !done && (
        <Caption1 className={styles.muted}>
          {m.missing}:{' '}
          {invalid
            .map(
              (id) => form.find((field) => field.id === id)?.label[locale] ?? (id === 'reviewStatus' ? m.review : id),
            )
            .join(', ')}
        </Caption1>
      )}
    </Card>
  );
}

export const TaskDocumentResult = memo(function TaskDocumentResult({
  taskId,
  record: source,
}: {
  taskId: TaskId;
  record?: TaskRecord;
}) {
  const record = useWorkflowSelector(({ state }) => source ?? getRecord(state, taskId));
  const { locale } = useI18n();
  const m = DOCUMENT_MESSAGES[locale];
  const styles = useStyles();
  return (
    <div className={styles.fields}>
      {taskForm(taskId).map((field) => (
        <div key={field.id}>
          <strong>{field.label[locale]}</strong>
          <p className={styles.content}>{record.document?.answers[field.id] || m.noRecord}</p>
        </div>
      ))}
      {record.note && <p className={styles.content}>{record.note}</p>}
      <EvidenceEditor
        evidence={[
          ...(record.evidence ?? []),
          ...(record.link && /^https?:\/\//i.test(record.link)
            ? [
                {
                  id: 'legacy-link',
                  kind: 'link' as const,
                  title: locale === 'ko' ? '기존 산출물 링크' : 'Legacy output link',
                  description: '',
                  url: record.link,
                },
              ]
            : []),
        ]}
        readOnly
      />
    </div>
  );
});
