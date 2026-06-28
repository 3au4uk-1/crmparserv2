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

export function useAddItemToBlacklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, itemId }) =>
      api.post(`/deals/${dealId}/items/${itemId}/blacklist`).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['blacklist'] });
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['deals'] });
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

export async function downloadExportFile(jobId, from, to) {
  const resp = await api.get(`/export/${jobId}/file`, { responseType: 'blob' });
  const url = URL.createObjectURL(resp.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `сделки_${from}_${to}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
