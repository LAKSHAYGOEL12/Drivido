import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useAuth } from './AuthContext';
import { fetchPromotionCatalog, fetchPromotionMe } from '../services/promotions';
import { hasAuthAccessToken } from '../services/api';
import type { PromotionCampaign, PromotionMeRow } from '../types/promotions';

const CATALOG_RETRY_MS = 1400;

type PromotionCampaignsValue = {
  catalog: PromotionCampaign[];
  meRows: PromotionMeRow[];
  loadingCatalog: boolean;
  loadingMe: boolean;
  /** Last catalog fetch error after retry; stale catalog may still be shown. */
  catalogLoadError: string | null;
  refreshCatalog: () => Promise<void>;
  refreshMe: () => Promise<void>;
  refreshAll: () => Promise<void>;
};

const PromotionCampaignsContext = createContext<PromotionCampaignsValue | null>(null);

export function PromotionCampaignsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { token } = useAuth();

  const [catalog, setCatalog] = useState<PromotionCampaign[]>([]);
  const [meRows, setMeRows] = useState<PromotionMeRow[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingMe, setLoadingMe] = useState(false);
  const [catalogLoadError, setCatalogLoadError] = useState<string | null>(null);
  const catalogSnapshotRef = useRef<PromotionCampaign[]>([]);

  const refreshCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogLoadError(null);
    const load = (): Promise<PromotionCampaign[]> => fetchPromotionCatalog();
    try {
      const next = await load();
      catalogSnapshotRef.current = next;
      setCatalog(next);
    } catch (e1) {
      if (__DEV__) console.warn('[promotions] catalog fetch failed, retrying once', e1);
      await new Promise<void>((resolve) => setTimeout(resolve, CATALOG_RETRY_MS));
      try {
        const next = await load();
        catalogSnapshotRef.current = next;
        setCatalog(next);
      } catch (e2) {
        const msg = e2 instanceof Error ? e2.message : 'Offers unavailable';
        setCatalogLoadError(msg);
        if (__DEV__) console.warn('[promotions] catalog failed after retry', e2);
        if (catalogSnapshotRef.current.length > 0) {
          setCatalog([...catalogSnapshotRef.current]);
        }
      }
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  const refreshMe = useCallback(async () => {
    if (!hasAuthAccessToken()) {
      setMeRows([]);
      return;
    }
    setLoadingMe(true);
    try {
      setMeRows(await fetchPromotionMe());
    } finally {
      setLoadingMe(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshCatalog(), refreshMe()]);
  }, [refreshCatalog, refreshMe]);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    if (!token?.trim()) {
      setMeRows([]);
      setLoadingMe(false);
      return;
    }
    if (!hasAuthAccessToken()) {
      setMeRows([]);
      return;
    }
    void refreshMe();
    /** First catalog fetch can run before JWT is in memory — retry once session is ready (fixes empty offers until reload). */
    void refreshCatalog();
  }, [token, refreshMe, refreshCatalog]);

  const value = useMemo(
    (): PromotionCampaignsValue => ({
      catalog,
      meRows,
      loadingCatalog,
      loadingMe,
      catalogLoadError,
      refreshCatalog,
      refreshMe,
      refreshAll,
    }),
    [catalog, meRows, loadingCatalog, loadingMe, catalogLoadError, refreshCatalog, refreshMe, refreshAll]
  );

  return (
    <PromotionCampaignsContext.Provider value={value}>{children}</PromotionCampaignsContext.Provider>
  );
}

export function usePromotionCampaigns(): PromotionCampaignsValue {
  const ctx = useContext(PromotionCampaignsContext);
  if (!ctx) {
    throw new Error('usePromotionCampaigns must be used within PromotionCampaignsProvider');
  }
  return ctx;
}
