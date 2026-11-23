import { Caption1, Card, mergeClasses, useArrowNavigationGroup } from '@fluentui/react-components';
import { Checkmark16Filled, LockClosed16Regular } from '@fluentui/react-icons';
import { summarizeStages } from '@process-flow/application';
import { useWorkflow } from '@process-flow/react';
import { useI18n } from '../i18n/useI18n';
import { DisabledReason } from './DisabledReason';
import { useStepperStyles } from './stepperStyles';

interface StageStepperProps {
  readonly viewingStage: number;
  readonly onSelectStage: (stageIndex: number) => void;
}

export function StageStepper({ viewingStage, onSelectStage }: StageStepperProps) {
  const styles = useStepperStyles();
  const { process, state } = useWorkflow();
  const { t, st } = useI18n();
  const arrowNav = useArrowNavigationGroup({ axis: 'horizontal' });

  return (
    <Card size="small" role="navigation" aria-label={t.stepperLabel} className={styles.nav}>
      <ol className={styles.list} {...arrowNav}>
        {summarizeStages(process, state).map(({ stage, locked, complete, isLast, progress, awaitingApproval }) => {
          const viewing = stage.index === viewingStage;
          const meta = locked
            ? t.statusLocked
            : awaitingApproval
              ? t.statusAwaitingApproval
              : complete
                ? t.statusDone
                : t.stepTasks(progress.done, progress.total);
          return (
            <li key={stage.index}>
              <DisabledReason reason={locked ? t.unlocksAfter(stage.index) : null}>
                <button
                  type="button"
                  className={mergeClasses(styles.step, locked && styles.stepLocked)}
                  aria-disabled={locked || undefined}
                  aria-current={viewing ? 'step' : undefined}
                  onClick={() => {
                    if (!locked) onSelectStage(stage.index);
                  }}
                >
                  <span className={styles.track}>
                    <span
                      aria-hidden="true"
                      className={mergeClasses(
                        styles.circle,
                        viewing && styles.circleCurrent,
                        complete && styles.circleComplete,
                        locked && styles.circleLocked,
                      )}
                    >
                      {complete ? <Checkmark16Filled /> : locked ? <LockClosed16Regular /> : stage.index + 1}
                    </span>
                    {!isLast && (
                      <span aria-hidden="true" className={mergeClasses(styles.line, complete && styles.lineComplete)} />
                    )}
                  </span>
                  <span className={styles.label}>
                    <span
                      className={mergeClasses(styles.name, viewing && styles.nameCurrent, locked && styles.nameLocked)}
                    >
                      {stage.index + 1}. {st(stage).name}
                    </span>
                    <Caption1 className={mergeClasses(styles.meta, locked && styles.nameLocked)}>{meta}</Caption1>
                  </span>
                </button>
              </DisabledReason>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
