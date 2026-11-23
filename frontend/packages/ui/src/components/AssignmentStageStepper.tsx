import { Caption1, Card, mergeClasses, makeStyles, tokens, useArrowNavigationGroup } from '@fluentui/react-components';
import { useStepperStyles } from './stepperStyles';

const useStyles = makeStyles({
  missing: { color: tokens.colorStatusWarningForeground1 },
});

export interface AssignmentStep {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly summary: string;
  readonly hasAccountable: boolean;
}

interface AssignmentStageStepperProps {
  readonly label: string;
  readonly steps: readonly AssignmentStep[];
  readonly selectedId: string;
  readonly onSelect: (stageId: string) => void;
  readonly panelId: string;
  readonly tabIdFor: (stageId: string) => string;
}

export function AssignmentStageStepper({
  label,
  steps,
  selectedId,
  onSelect,
  panelId,
  tabIdFor,
}: AssignmentStageStepperProps) {
  const styles = useStepperStyles();
  const local = useStyles();
  const arrowNav = useArrowNavigationGroup({ axis: 'horizontal', memorizeCurrent: true });
  return (
    <Card size="small" className={styles.nav}>
      <div role="tablist" aria-label={label} className={styles.list} {...arrowNav}>
        {steps.map((step, position) => {
          const selected = step.id === selectedId;
          return (
            <button
              key={step.id}
              type="button"
              role="tab"
              id={tabIdFor(step.id)}
              aria-selected={selected}
              aria-controls={panelId}
              className={styles.step}
              onClick={() => onSelect(step.id)}
            >
              <span className={styles.track}>
                <span aria-hidden="true" className={mergeClasses(styles.circle, selected && styles.circleCurrent)}>
                  {step.index + 1}
                </span>
                {position < steps.length - 1 && <span aria-hidden="true" className={styles.line} />}
              </span>
              <span className={styles.label}>
                <span className={mergeClasses(styles.name, selected && styles.nameCurrent)}>
                  {step.index + 1}. {step.name}
                </span>
                <Caption1 className={step.hasAccountable ? styles.meta : local.missing}>{step.summary}</Caption1>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
