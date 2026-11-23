import { useEffect } from 'react';
import { type MyWorkState, useNavigation } from '@process-flow/react';
import { HOME } from '@process-flow/application';
import { useI18n } from '../i18n/useI18n';
import { MyWork } from '../components/MyWork';
import { PageLayout } from './PageLayout';

export function MyWorkPage({ work }: { readonly work: MyWorkState }) {
  const { t } = useI18n();
  const { navigate } = useNavigation();
  const reload = work.reload;
  useEffect(() => {
    reload();
  }, [reload]);
  return (
    <PageLayout title={t.myWork} description={t.myWorkDescription}>
      <MyWork work={work} onNavigate={() => navigate(HOME)} />
    </PageLayout>
  );
}
