import {
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Button,
  Caption1,
  Title3,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { ArrowLeft20Regular } from '@fluentui/react-icons';
import { Fragment, useEffect, type ReactNode } from 'react';
import { useNavigation, useWorkflow } from '@process-flow/react';
import { HOME, type Route } from '@process-flow/application';
import { useI18n } from '../i18n/useI18n';
import { useDrawerFocus } from '../components/drawerFocus';

const useStyles = makeStyles({
  bar: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  inner: {
    maxWidth: '1376px',
    margin: '0 auto',
    padding: `0 ${tokens.spacingHorizontalXXXL}`,
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalL,
    paddingBottom: tokens.spacingVerticalL,
  },
  nav: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacingHorizontalL },
  title: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: tokens.spacingHorizontalS, minWidth: 0 },
  heading: { margin: 0, minWidth: 0, overflowWrap: 'anywhere', ':focus': { outline: 'none' } },
  note: { color: tokens.colorNeutralForeground3 },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    paddingTop: tokens.spacingVerticalXXL,
    paddingBottom: tokens.spacingVerticalXXXL,
  },
});

export interface Crumb {
  readonly label: string;
  readonly route: Route;
}

interface PageLayoutProps {
  readonly trail?: readonly Crumb[];
  readonly title: string;
  readonly titleAddon?: ReactNode;
  readonly description?: string;
  readonly focusKey?: unknown;
  readonly children: ReactNode;
}

export function PageLayout({ trail = [], title, titleAddon, description, focusKey, children }: PageLayoutProps) {
  const styles = useStyles();
  const { t } = useI18n();
  const { navigate, back } = useNavigation();
  const { dispatch } = useWorkflow();
  const { titleRef, bodyRef, focusTitle } = useDrawerFocus(true);
  useEffect(() => {
    focusTitle();
  }, [focusTitle, focusKey]);
  const crumbs: readonly Crumb[] = [{ label: t.home, route: HOME }, ...trail];
  return (
    <>
      <div className={styles.bar}>
        <div className={`${styles.inner} ${styles.header}`}>
          <div className={styles.nav}>
            <Breadcrumb size="small" aria-label={t.breadcrumb}>
              {crumbs.map((crumb) => (
                <Fragment key={crumb.label}>
                  <BreadcrumbItem>
                    <BreadcrumbButton
                      onClick={() => {
                        if (crumb.route.page === 'workflow') dispatch({ type: 'setView', view: 'board' });
                        navigate(crumb.route);
                      }}
                    >
                      {crumb.label}
                    </BreadcrumbButton>
                  </BreadcrumbItem>
                  <BreadcrumbDivider />
                </Fragment>
              ))}
              <BreadcrumbItem>
                <BreadcrumbButton current>{title}</BreadcrumbButton>
              </BreadcrumbItem>
            </Breadcrumb>
            <Button appearance="subtle" size="small" icon={<ArrowLeft20Regular />} onClick={back}>
              {t.back}
            </Button>
          </div>
          <div className={styles.title}>
            <h1 ref={titleRef} tabIndex={-1} className={styles.heading}>
              <Title3>{title}</Title3>
            </h1>
            {titleAddon}
          </div>
          {description && <Caption1 className={styles.note}>{description}</Caption1>}
        </div>
      </div>
      <div className={styles.inner}>
        <div ref={bodyRef} className={styles.content}>
          {children}
        </div>
      </div>
    </>
  );
}
