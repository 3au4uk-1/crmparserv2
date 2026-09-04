import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const TOKEN_KEY = 'app_token';

const api = axios.create({ baseURL: '/api' });

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && getAuthToken()) {
      setAuthToken(null);
      window.dispatchEvent(new Event('auth:logout'));
    }
    return Promise.reject(error);
  }
);

export function useAuthStatus() {
  return useQuery({
    queryKey: ['auth-status'],
    queryFn: () => api.get('/auth/status').then((r) => r.data),
    retry: false,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (password) => {
      try {
        return await api.post('/auth/login', { password }).then((r) => r.data);
      } catch (err) {
        const message = err.response?.data?.error || 'Ошибка входа';
        throw new Error(message);
      }
    },
    onSuccess: (data) => {
      if (data.token) setAuthToken(data.token);
      qc.invalidateQueries({ queryKey: ['auth-status'] });
    },
  });
}

export function useDeals(params = {}) {
  return useQuery({
    queryKey: ['deals', params],
    queryFn: () => api.get('/deals', { params }).then(r => r.data),
  });
}

export function useDealStats() {
  return useQuery({
    queryKey: ['deal-stats'],
    queryFn: () => api.get('/deals/stats').then(r => r.data),
  });
}

export function useDeal(id) {
  return useQuery({
    queryKey: ['deal', id],
    queryFn: () => api.get(`/deals/${id}`).then(r => r.data),
    enabled: !!id,
  });
}

export function useUpdateItemSyncOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, itemId, syncOverride }) =>
      api.patch(`/deals/${dealId}/items/${itemId}/sync-override`, { syncOverride }).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
    },
  });
}

export function useResetSyncOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dealId) =>
      api.post(`/deals/${dealId}/items/reset-sync-overrides`).then((r) => r.data),
    onSuccess: (_, dealId) => {
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
    },
  });
}

export function useAttachTonyBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, bookingNumber }) =>
      api.patch(`/deals/${dealId}/tony-booking`, { bookingNumber }).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
    },
  });
}

export function useApproveDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.patch(`/deals/${id}/approve`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
    },
  });
}

export function useResyncDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.post(`/deals/${id}/resync`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
    },
  });
}

export function useRejectDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.patch(`/deals/${id}/reject`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
    },
  });
}

export function useBulkApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids) => api.post('/deals/bulk-approve', { ids }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
    },
  });
}

export function useBulkReject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids) => api.post('/deals/bulk-reject', { ids }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
    },
  });
}

export function useDeleteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/deals/${id}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
    },
  });
}

export function useBulkDeleteDeals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids) => api.post('/deals/bulk-delete', { ids }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
    },
  });
}

export function useDeleteAllRejected() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('/deals/rejected').then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
    },
  });
}

export function useParseDefaults() {
  return useQuery({
    queryKey: ['parse-defaults'],
    queryFn: () => api.get('/parsing/defaults').then((r) => r.data),
  });
}

export function useRunParsing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post('/parsing/run', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
      qc.invalidateQueries({ queryKey: ['parse-runs'] });
    },
  });
}

export function useParsingStatus() {
  return useQuery({
    queryKey: ['parsing-status'],
    queryFn: () => api.get('/parsing/status').then(r => r.data),
    refetchInterval: 5000,
  });
}

export function useParseRuns() {
  return useQuery({
    queryKey: ['parse-runs'],
    queryFn: () => api.get('/parsing/runs').then(r => r.data),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
  });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }) => api.put(`/settings/${key}`, { value }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function useClearParsingData() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/settings/clear-parsing-data').then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal-stats'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
      qc.invalidateQueries({ queryKey: ['logs'] });
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
      qc.invalidateQueries({ queryKey: ['parse-runs'] });
    },
  });
}

export function useKeywords() {
  return useQuery({
    queryKey: ['keywords'],
    queryFn: () => api.get('/settings/keywords').then(r => r.data),
  });
}

export function useUpdateKeywords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keywords) => api.put('/settings/keywords', { keywords }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['keywords'] }),
  });
}

export function useDecorKeywords() {
  return useQuery({
    queryKey: ['decor-keywords'],
    queryFn: () => api.get('/settings/decor-keywords').then((r) => r.data),
  });
}

export function useUpdateDecorKeywords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keywords) => api.put('/settings/decor-keywords', { keywords }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decor-keywords'] }),
  });
}

export function useMkKeywords() {
  return useQuery({
    queryKey: ['mk-keywords'],
    queryFn: () => api.get('/settings/mk-keywords').then((r) => r.data),
  });
}

export function useUpdateMkKeywords() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keywords) => api.put('/settings/mk-keywords', { keywords }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mk-keywords'] }),
  });
}

export function useBlacklist() {
  return useQuery({
    queryKey: ['blacklist'],
    queryFn: () => api.get('/blacklist').then((r) => r.data.items),
  });
}

export function useAddBlacklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pattern, matchType, sourceName }) =>
      api.post('/blacklist', { pattern, matchType, sourceName }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blacklist'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useRemoveBlacklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/blacklist/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blacklist'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useDecorBlacklist() {
  return useQuery({
    queryKey: ['decor-blacklist'],
    queryFn: () => api.get('/decor-blacklist').then((r) => r.data.items),
  });
}

export function useAddDecorBlacklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pattern, matchType, sourceName }) =>
      api.post('/decor-blacklist', { pattern, matchType, sourceName }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decor-blacklist'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useRemoveDecorBlacklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/decor-blacklist/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['decor-blacklist'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useMkBlacklist() {
  return useQuery({
    queryKey: ['mk-blacklist'],
    queryFn: () => api.get('/mk-blacklist').then((r) => r.data.items),
  });
}

export function useAddMkBlacklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pattern, matchType, sourceName }) =>
      api.post('/mk-blacklist', { pattern, matchType, sourceName }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mk-blacklist'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useRemoveMkBlacklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/mk-blacklist/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mk-blacklist'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useAddItemToBlacklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, itemId }) =>
      api.post(`/deals/${dealId}/items/${itemId}/blacklist`).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['blacklist'] });
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
    },
  });
}

export function useRestorationList() {
  return useQuery({
    queryKey: ['restoration'],
    queryFn: () => api.get('/restoration').then((r) => r.data.items),
  });
}

export function useAddRestorationItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pattern, matchType, sourceName }) =>
      api.post('/restoration', { pattern, matchType, sourceName }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['restoration'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useRemoveRestorationItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/restoration/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['restoration'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useAddItemToRestoration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, itemId }) =>
      api.post(`/deals/${dealId}/items/${itemId}/restoration`).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['restoration'] });
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
    },
  });
}

export function useNeNasheBrandingList() {
  return useQuery({
    queryKey: ['ne-nashe-branding'],
    queryFn: () => api.get('/ne-nashe-branding').then((r) => r.data.items),
  });
}

export function useAddNeNasheBrandingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pattern, matchType, sourceName }) =>
      api.post('/ne-nashe-branding', { pattern, matchType, sourceName }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ne-nashe-branding'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useRemoveNeNasheBrandingItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/ne-nashe-branding/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ne-nashe-branding'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useNeNasheDecorMkList() {
  return useQuery({
    queryKey: ['ne-nashe-decor-mk'],
    queryFn: () => api.get('/ne-nashe-decor-mk').then((r) => r.data.items),
  });
}

export function useAddNeNasheDecorMkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pattern, matchType, sourceName }) =>
      api.post('/ne-nashe-decor-mk', { pattern, matchType, sourceName }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ne-nashe-decor-mk'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useRemoveNeNasheDecorMkItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/ne-nashe-decor-mk/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ne-nashe-decor-mk'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function usePodryadList() {
  return useQuery({
    queryKey: ['podryad'],
    queryFn: () => api.get('/podryad').then((r) => r.data.items),
  });
}

export function useAddPodryadItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pattern, matchType, sourceName }) =>
      api.post('/podryad', { pattern, matchType, sourceName }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['podryad'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useRemovePodryadItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/podryad/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['podryad'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useAddItemToPodryad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, itemId }) =>
      api.post(`/deals/${dealId}/items/${itemId}/podryad`).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['podryad'] });
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
    },
  });
}

export function useBannerList() {
  return useQuery({
    queryKey: ['banner'],
    queryFn: () => api.get('/banner').then((r) => r.data.items),
  });
}

export function useAddBannerItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pattern, matchType, sourceName }) =>
      api.post('/banner', { pattern, matchType, sourceName }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banner'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useRemoveBannerItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/banner/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['banner'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useAddItemToBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, itemId }) =>
      api.post(`/deals/${dealId}/items/${itemId}/banner`).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['banner'] });
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
    },
  });
}

export function useTipRules(tip) {
  return useQuery({
    queryKey: ['tip-rules', tip ?? 'all'],
    queryFn: () =>
      api.get('/tip-rules', { params: tip ? { tip } : {} }).then((r) => r.data.items),
  });
}

export function useAddTipRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post('/tip-rules', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tip-rules'] });
      qc.invalidateQueries({ queryKey: ['podryad'] });
      qc.invalidateQueries({ queryKey: ['banner'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useRemoveTipRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/tip-rules/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tip-rules'] });
      qc.invalidateQueries({ queryKey: ['podryad'] });
      qc.invalidateQueries({ queryKey: ['banner'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useCompanies() {
  return useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get('/settings/companies').then(r => r.data),
  });
}

export function useCreateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post('/settings/companies', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });
}

export function useLogs(params = {}) {
  return useQuery({
    queryKey: ['logs', params],
    queryFn: () => api.get('/logs', { params }).then((r) => r.data),
  });
}

export function useSyncLogs(params = {}) {
  return useQuery({
    queryKey: ['sync-logs', params],
    queryFn: () => api.get('/logs', { params: { ...params, type: 'sync' } }).then((r) => r.data),
  });
}

export function useUpdateItemClassification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, itemId, classification }) =>
      api.patch(`/deals/${dealId}/items/${itemId}`, { classification }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useStartExport() {
  return useMutation({
    mutationFn: (body) => api.post('/export', body).then((r) => r.data),
  });
}

export function useExportJob(jobId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['export-job', jobId],
    queryFn: () => api.get(`/export/${jobId}`).then((r) => r.data),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 2000 : false;
    },
  });
}

export function useActiveExportJob() {
  return useQuery({
    queryKey: ['export-active'],
    queryFn: () => api.get('/export/active').then((r) => r.data),
  });
}

export function useStartTwentyExport() {
  return useMutation({
    mutationFn: (body) => api.post('/export/twenty', body).then((r) => r.data),
  });
}

export function useTwentyExportColumns() {
  return useQuery({
    queryKey: ['export-twenty-columns'],
    queryFn: () => api.get('/export/twenty/columns').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTwentyExportJob(jobId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['export-twenty-job', jobId],
    queryFn: () => api.get(`/export/twenty/${jobId}`).then((r) => r.data),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 2000 : false;
    },
  });
}

export function useActiveTwentyExportJob() {
  return useQuery({
    queryKey: ['export-twenty-active'],
    queryFn: () => api.get('/export/twenty/active').then((r) => r.data),
  });
}

function isExpenseJobRunning(status) {
  return status === 'queued' || status === 'running';
}

export function useStartExpenseSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/expenses/sync').then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-active-job'] });
    },
  });
}

export function useActiveExpenseJob() {
  return useQuery({
    queryKey: ['expense-active-job'],
    queryFn: () => api.get('/expenses/jobs/active').then((r) => r.data),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isExpenseJobRunning(status) ? 2000 : false;
    },
  });
}

export function useExpenseJob(jobId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['expense-job', jobId],
    queryFn: () => api.get(`/expenses/jobs/${jobId}`).then((r) => r.data),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isExpenseJobRunning(status) ? 2000 : false;
    },
  });
}

export function useUploadBeznal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file) => {
      const formData = new FormData();
      formData.append('file', file);
      return api
        .post('/expenses/beznal-upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-active-job'] });
    },
  });
}

function isBulkResyncJobRunning(status) {
  return status === 'queued' || status === 'running';
}

export function fetchBulkResyncPreview() {
  return api.get('/deals/bulk-resync/preview').then((r) => r.data);
}

export function useStartBulkResync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/deals/bulk-resync').then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bulk-resync-active-job'] });
    },
  });
}

export function useActiveBulkResyncJob() {
  return useQuery({
    queryKey: ['bulk-resync-active-job'],
    queryFn: () => api.get('/deals/bulk-resync/jobs/active').then((r) => r.data),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isBulkResyncJobRunning(status) ? 2000 : false;
    },
  });
}

export function useBulkResyncJob(jobId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['bulk-resync-job', jobId],
    queryFn: () => api.get(`/deals/bulk-resync/jobs/${jobId}`).then((r) => r.data),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isBulkResyncJobRunning(status) ? 2000 : false;
    },
  });
}

function isProductStreamBackfillJobRunning(status) {
  return status === 'queued' || status === 'running';
}

export function fetchProductStreamBackfillPreview() {
  return api.get('/deals/product-stream-backfill/preview').then((r) => r.data);
}

export function useStartProductStreamBackfill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/deals/product-stream-backfill').then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product-stream-backfill-active-job'] });
    },
  });
}

export function useActiveProductStreamBackfillJob() {
  return useQuery({
    queryKey: ['product-stream-backfill-active-job'],
    queryFn: () => api.get('/deals/product-stream-backfill/jobs/active').then((r) => r.data),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isProductStreamBackfillJobRunning(status) ? 2000 : false;
    },
  });
}

export function useProductStreamBackfillJob(jobId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['product-stream-backfill-job', jobId],
    queryFn: () => api.get(`/deals/product-stream-backfill/jobs/${jobId}`).then((r) => r.data),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isProductStreamBackfillJobRunning(status) ? 2000 : false;
    },
  });
}

function isRestoreMissingTwentyJobRunning(status) {
  return status === 'queued' || status === 'running';
}

export function fetchRestoreMissingTwentyPreview() {
  return api.get('/deals/restore-missing-twenty/preview').then((r) => r.data);
}

export function fetchPaymentSyncPreview({ from, to }) {
  return api.get('/deals/payment-sync/preview', { params: { from, to } }).then((r) => r.data);
}

export function usePaymentSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ from, to }) =>
      api.post('/deals/payment-sync', { from, to }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useStartRestoreMissingTwenty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/deals/restore-missing-twenty').then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['restore-missing-twenty-active-job'] });
    },
  });
}

export function useActiveRestoreMissingTwentyJob() {
  return useQuery({
    queryKey: ['restore-missing-twenty-active-job'],
    queryFn: () => api.get('/deals/restore-missing-twenty/jobs/active').then((r) => r.data),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isRestoreMissingTwentyJobRunning(status) ? 2000 : false;
    },
  });
}

export function useRestoreMissingTwentyJob(jobId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['restore-missing-twenty-job', jobId],
    queryFn: () => api.get(`/deals/restore-missing-twenty/jobs/${jobId}`).then((r) => r.data),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isRestoreMissingTwentyJobRunning(status) ? 2000 : false;
    },
  });
}

export async function downloadExportFile(jobId, from, to) {
  const resp = await api.get(`/export/${jobId}/file`, { responseType: 'blob' });
  const url = URL.createObjectURL(resp.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `сделки_${from}_${to}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function downloadTwentyExportFile(jobId, from, to) {
  const resp = await api.get(`/export/twenty/${jobId}/file`, { responseType: 'blob' });
  const url = URL.createObjectURL(resp.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `twenty_заказы_${from}_${to}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export function useTelegramSettings() {
  return useQuery({
    queryKey: ['telegram-settings'],
    queryFn: () => api.get('/telegram/settings').then((r) => r.data),
  });
}

export function useUpdateTelegramSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.put('/telegram/settings', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-settings'] }),
  });
}

export function useTestTelegramBot() {
  return useMutation({
    mutationFn: () => api.post('/telegram/test-bot').then((r) => r.data),
  });
}

export function useTestTelegramSend() {
  return useMutation({
    mutationFn: (body = {}) => api.post('/telegram/test-send', body).then((r) => r.data),
  });
}

export function useTelegramChats(activeOnly = true, queryOptions = {}) {
  return useQuery({
    queryKey: ['telegram-chats', activeOnly],
    queryFn: () =>
      api
        .get('/telegram/chats', { params: { active: activeOnly ? '1' : '0' } })
        .then((r) => r.data),
    ...queryOptions,
  });
}

export function useTelegramTopics(chatId) {
  return useQuery({
    queryKey: ['telegram-topics', chatId],
    queryFn: () =>
      api.get(`/telegram/chats/${encodeURIComponent(chatId)}/topics`).then((r) => r.data),
    enabled: Boolean(chatId),
  });
}

export function useAddTelegramChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post('/telegram/chats', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-chats'] }),
  });
}

export function useRefreshTelegramChats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/telegram/chats/refresh').then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['telegram-chats'] });
      qc.invalidateQueries({ queryKey: ['telegram-topics'] });
    },
  });
}

export function useAddTelegramTopic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, threadId, name }) =>
      api
        .post(`/telegram/chats/${encodeURIComponent(chatId)}/topics`, { threadId, name })
        .then((r) => r.data),
    onSuccess: (_data, { chatId }) => {
      qc.invalidateQueries({ queryKey: ['telegram-topics', chatId] });
    },
  });
}

export function useTelegramMentionForward() {
  return useQuery({
    queryKey: ['telegram-mention-forward'],
    queryFn: () => api.get('/telegram/mention-forward').then((r) => r.data),
  });
}

export function useSaveTelegramMentionForward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.put('/telegram/mention-forward', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-mention-forward'] }),
  });
}

export function useTelegramWebhookStatus() {
  return useQuery({
    queryKey: ['telegram-webhook-status'],
    queryFn: () => api.get('/telegram/webhook/status').then((r) => r.data),
  });
}

export function useSetupTelegramWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/telegram/webhook/setup').then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-webhook-status'] }),
  });
}

export function useTeardownTelegramWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/telegram/webhook/teardown').then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-webhook-status'] }),
  });
}

export function useTelegramAutoInviteStatus() {
  return useQuery({
    queryKey: ['telegram-auto-invite-status'],
    queryFn: () => api.get('/telegram/auto-invite/status').then((r) => r.data),
  });
}

export function useTelegramAutoInviteMembers() {
  return useQuery({
    queryKey: ['telegram-auto-invite-members'],
    queryFn: () => api.get('/telegram/auto-invite/members').then((r) => r.data),
  });
}

export function useAddTelegramAutoInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post('/telegram/auto-invite/members', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-auto-invite-members'] }),
  });
}

export function useUpdateTelegramAutoInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }) =>
      api.patch(`/telegram/auto-invite/members/${id}`, patch).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-auto-invite-members'] }),
  });
}

export function useDeleteTelegramAutoInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/telegram/auto-invite/members/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-auto-invite-members'] }),
  });
}

export function useRetryTelegramAutoInviteRun() {
  return useMutation({
    mutationFn: (chatId) =>
      api
        .post(`/telegram/auto-invite/runs/${encodeURIComponent(chatId)}/retry`)
        .then((r) => r.data),
  });
}

function invalidateTelegramUserbotAuth(qc) {
  qc.invalidateQueries({ queryKey: ['telegram-userbot-auth-status'] });
  qc.invalidateQueries({ queryKey: ['telegram-auto-invite-status'] });
}

export function useTelegramUserbotAuthStatus() {
  return useQuery({
    queryKey: ['telegram-userbot-auth-status'],
    queryFn: () => api.get('/telegram/userbot/auth/status').then((r) => r.data),
  });
}

export function useTelegramUserbotAuthStart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phone) =>
      api.post('/telegram/userbot/auth/start', { phone }).then((r) => r.data),
    onSuccess: () => invalidateTelegramUserbotAuth(qc),
  });
}

export function useTelegramUserbotAuthCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code) =>
      api.post('/telegram/userbot/auth/code', { code }).then((r) => r.data),
    onSuccess: () => invalidateTelegramUserbotAuth(qc),
  });
}

export function useTelegramUserbotAuthPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password) =>
      api.post('/telegram/userbot/auth/password', { password }).then((r) => r.data),
    onSuccess: () => invalidateTelegramUserbotAuth(qc),
  });
}

export function useTelegramUserbotAuthCancel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/telegram/userbot/auth/cancel').then((r) => r.data),
    onSuccess: () => invalidateTelegramUserbotAuth(qc),
  });
}

export function useTelegramUserbotAuthLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/telegram/userbot/auth/logout').then((r) => r.data),
    onSuccess: () => invalidateTelegramUserbotAuth(qc),
  });
}
