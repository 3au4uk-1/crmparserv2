import { useState, useEffect, useMemo } from 'react';
import PageHeader from '../components/ui/PageHeader';
import {
  useTelegramSettings,
  useUpdateTelegramSettings,
  useTestTelegramBot,
  useTestTelegramSend,
  useTelegramChats,
  useTelegramTopics,
  useAddTelegramChat,
  useRefreshTelegramChats,
  useAddTelegramTopic,
  useTelegramWebhookStatus,
  useSetupTelegramWebhook,
  useTeardownTelegramWebhook,
  useTelegramMentionForward,
  useSaveTelegramMentionForward,
  useTelegramAutoInviteStatus,
  useTelegramAutoInviteMembers,
  useAddTelegramAutoInviteMember,
  useUpdateTelegramAutoInviteMember,
  useDeleteTelegramAutoInviteMember,
  useRetryTelegramAutoInviteRun,
  useTelegramUserbotAuthStatus,
  useTelegramUserbotAuthStart,
  useTelegramUserbotAuthCode,
  useTelegramUserbotAuthPassword,
  useTelegramUserbotAuthCancel,
  useTelegramUserbotAuthLogout,
} from '../api';

function Section({ title, description, children }) {
  return (
    <section className="surface p-5 md:p-6 mb-4">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {description && (
          <p className="text-sm text-ink-muted mt-1 max-w-2xl leading-relaxed">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function FieldLabel({ children }) {
  return <label className="block text-sm font-medium text-ink-muted mb-1.5">{children}</label>;
}

function readChatDest(chatMap, key) {
  const raw = chatMap?.[key];
  if (!raw) return { chatId: '', threadId: '' };
  if (typeof raw === 'string') return { chatId: raw, threadId: '' };
  return {
    chatId: raw.chatId || '',
    threadId: raw.threadId != null ? String(raw.threadId) : '',
  };
}

function formatChatLabel(chat, { showInactive = false } = {}) {
  const title = chat.title || chat.username || chat.chatId;
  const suffix = chat.isForum ? ' · форум' : '';
  const inactiveSuffix = showInactive || chat.active === false ? ' · неактивен' : '';
  return `${title}${suffix}${inactiveSuffix}`;
}

function formatTopicLabel(topic) {
  return topic.name ? topic.name : `#${topic.threadId}`;
}

function formatUserbotUserLabel(user) {
  if (!user) return null;
  if (user.username) return `@${user.username}`;
  if (user.firstName) return user.firstName;
  if (user.id) return `id ${user.id}`;
  return null;
}

export default function Telegram() {
  const { data: telegramSettings } = useTelegramSettings();
  const updateTelegramSettings = useUpdateTelegramSettings();
  const testTelegramBot = useTestTelegramBot();
  const testTelegramSend = useTestTelegramSend();
  const {
    data: webhookStatus,
    refetch: refetchWebhook,
    isLoading: webhookLoading,
  } = useTelegramWebhookStatus();
  const setupWebhook = useSetupTelegramWebhook();
  const teardownWebhook = useTeardownTelegramWebhook();
  const {
    data: autoInviteStatus,
    isLoading: autoInviteStatusLoading,
  } = useTelegramAutoInviteStatus();
  const { data: autoInviteMembersData, isLoading: autoInviteMembersLoading } =
    useTelegramAutoInviteMembers();
  const addAutoInviteMember = useAddTelegramAutoInviteMember();
  const updateAutoInviteMember = useUpdateTelegramAutoInviteMember();
  const deleteAutoInviteMember = useDeleteTelegramAutoInviteMember();
  const retryAutoInviteRun = useRetryTelegramAutoInviteRun();
  const {
    data: userbotAuthStatus,
    isLoading: userbotAuthLoading,
  } = useTelegramUserbotAuthStatus();
  const userbotAuthStart = useTelegramUserbotAuthStart();
  const userbotAuthCode = useTelegramUserbotAuthCode();
  const userbotAuthPassword = useTelegramUserbotAuthPassword();
  const userbotAuthCancel = useTelegramUserbotAuthCancel();
  const userbotAuthLogout = useTelegramUserbotAuthLogout();

  const [activeOnly, setActiveOnly] = useState(true);
  const { data: chatsData, isLoading: chatsLoading, refetch: refetchChats } = useTelegramChats(activeOnly);
  const addChat = useAddTelegramChat();
  const refreshChats = useRefreshTelegramChats();
  const addTopic = useAddTelegramTopic();

  const [tokenInput, setTokenInput] = useState('');
  const [manualChatId, setManualChatId] = useState('');
  const [okleykaChatId, setOkleykaChatId] = useState('');
  const [okleykaThreadId, setOkleykaThreadId] = useState('');
  const [digestChatId, setDigestChatId] = useState('');
  const [digestThreadId, setDigestThreadId] = useState('');
  const [bannerChatId, setBannerChatId] = useState('');
  const [bannerThreadId, setBannerThreadId] = useState('');
  const [bannerHour, setBannerHour] = useState('18');
  const [manualThreadId, setManualThreadId] = useState('');
  const [manualTopicName, setManualTopicName] = useState('');
  const [digestManualThreadId, setDigestManualThreadId] = useState('');
  const [digestManualTopicName, setDigestManualTopicName] = useState('');
  const [bannerManualThreadId, setBannerManualThreadId] = useState('');
  const [bannerManualTopicName, setBannerManualTopicName] = useState('');
  const [autoInviteUsername, setAutoInviteUsername] = useState('');
  const [autoInviteUserId, setAutoInviteUserId] = useState('');
  const [autoInviteDisplayName, setAutoInviteDisplayName] = useState('');
  const [retryChatId, setRetryChatId] = useState('');
  const [userbotPhone, setUserbotPhone] = useState('');
  const [userbotCode, setUserbotCode] = useState('');
  const [userbotPassword, setUserbotPassword] = useState('');

  const [saveError, setSaveError] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const { data: mentionForwardData } = useTelegramMentionForward();
  const saveMentionForward = useSaveTelegramMentionForward();
  const [mentionChatId, setMentionChatId] = useState('');
  const [mentionTopicId, setMentionTopicId] = useState('');

  const autoInviteConfigured = Boolean(autoInviteStatus?.configured);
  const autoInviteMembers = autoInviteMembersData?.members ?? [];
  const userbotApiConfigured = Boolean(userbotAuthStatus?.apiConfigured);
  const userbotSessionSet = Boolean(userbotAuthStatus?.sessionSet);
  const userbotPending = userbotAuthStatus?.pending ?? null;
  const userbotUserLabel = formatUserbotUserLabel(userbotAuthStatus?.user);

  const chats = chatsData?.chats ?? [];
  const savedChatInActiveList = Boolean(
    okleykaChatId && chats.some((c) => c.chatId === okleykaChatId),
  );
  const savedDigestChatInActiveList = Boolean(
    digestChatId && chats.some((c) => c.chatId === digestChatId),
  );
  const savedBannerChatInActiveList = Boolean(
    bannerChatId && chats.some((c) => c.chatId === bannerChatId),
  );
  const needsInactiveLookup = Boolean(
    !chatsLoading &&
      ((okleykaChatId && !savedChatInActiveList) ||
        (digestChatId && !savedDigestChatInActiveList) ||
        (bannerChatId && !savedBannerChatInActiveList)),
  );
  const { data: inactiveChatsData, isLoading: inactiveChatsLoading } = useTelegramChats(
    false,
    { enabled: needsInactiveLookup },
  );
  const inactiveLookupChats = inactiveChatsData?.chats ?? [];

  const allKnownChats = useMemo(() => {
    const merged = [...chats];
    for (const chat of inactiveLookupChats) {
      if (!merged.some((c) => c.chatId === chat.chatId)) {
        merged.push(chat);
      }
    }
    return merged;
  }, [chats, inactiveLookupChats]);

  const selectedChat = allKnownChats.find((c) => c.chatId === okleykaChatId);
  const digestSelectedChat = allKnownChats.find((c) => c.chatId === digestChatId);
  const bannerSelectedChat = allKnownChats.find((c) => c.chatId === bannerChatId);
  const inactiveLookupDone = needsInactiveLookup && !inactiveChatsLoading;
  const selectedChatResolved =
    !okleykaChatId || savedChatInActiveList || inactiveLookupDone;
  const digestSelectedChatResolved =
    !digestChatId || savedDigestChatInActiveList || inactiveLookupDone;
  const bannerSelectedChatResolved =
    !bannerChatId || savedBannerChatInActiveList || inactiveLookupDone;
  const isForum = Boolean(selectedChat?.isForum);
  const digestIsForum = Boolean(digestSelectedChat?.isForum);
  const bannerIsForum = Boolean(bannerSelectedChat?.isForum);

  const okleykaChatOptions = useMemo(() => {
    const activeChats = chats.filter((c) => c.active);
    const options = activeChats.map((chat) => ({ chat, showInactive: false }));
    if (okleykaChatId && !activeChats.some((c) => c.chatId === okleykaChatId)) {
      const savedChat = allKnownChats.find((c) => c.chatId === okleykaChatId);
      if (savedChat) {
        options.push({ chat: savedChat, showInactive: true });
      }
    }
    return options;
  }, [chats, allKnownChats, okleykaChatId]);

  const digestChatOptions = useMemo(() => {
    const activeChats = chats.filter((c) => c.active);
    const options = activeChats.map((chat) => ({ chat, showInactive: false }));
    if (digestChatId && !activeChats.some((c) => c.chatId === digestChatId)) {
      const savedChat = allKnownChats.find((c) => c.chatId === digestChatId);
      if (savedChat) {
        options.push({ chat: savedChat, showInactive: true });
      }
    }
    return options;
  }, [chats, allKnownChats, digestChatId]);

  const bannerChatOptions = useMemo(() => {
    const activeChats = chats.filter((c) => c.active);
    const options = activeChats.map((chat) => ({ chat, showInactive: false }));
    if (bannerChatId && !activeChats.some((c) => c.chatId === bannerChatId)) {
      const savedChat = allKnownChats.find((c) => c.chatId === bannerChatId);
      if (savedChat) {
        options.push({ chat: savedChat, showInactive: true });
      }
    }
    return options;
  }, [chats, allKnownChats, bannerChatId]);

  const { data: topicsData } = useTelegramTopics(isForum ? okleykaChatId : '');
  const cachedTopics = topicsData?.topics ?? [];
  const { data: digestTopicsData } = useTelegramTopics(digestIsForum ? digestChatId : '');
  const digestCachedTopics = digestTopicsData?.topics ?? [];
  const { data: bannerTopicsData } = useTelegramTopics(bannerIsForum ? bannerChatId : '');
  const bannerCachedTopics = bannerTopicsData?.topics ?? [];

  const topicOptions = useMemo(() => {
    if (!isForum) return [];
    const general = { threadId: '1', name: 'General (thread 1)', synthetic: true };
    const fromDb = cachedTopics.map((t) => ({
      threadId: String(t.threadId),
      name: formatTopicLabel(t),
      synthetic: false,
    }));
    const seen = new Set();
    const merged = [general];
    seen.add('1');
    for (const t of fromDb) {
      if (!seen.has(t.threadId)) {
        merged.push(t);
        seen.add(t.threadId);
      }
    }
    return merged;
  }, [isForum, cachedTopics]);

  const digestTopicOptions = useMemo(() => {
    if (!digestIsForum) return [];
    const general = { threadId: '1', name: 'General (thread 1)', synthetic: true };
    const fromDb = digestCachedTopics.map((t) => ({
      threadId: String(t.threadId),
      name: formatTopicLabel(t),
      synthetic: false,
    }));
    const seen = new Set();
    const merged = [general];
    seen.add('1');
    for (const t of fromDb) {
      if (!seen.has(t.threadId)) {
        merged.push(t);
        seen.add(t.threadId);
      }
    }
    return merged;
  }, [digestIsForum, digestCachedTopics]);

  const bannerTopicOptions = useMemo(() => {
    if (!bannerIsForum) return [];
    const general = { threadId: '1', name: 'General (thread 1)', synthetic: true };
    const fromDb = bannerCachedTopics.map((t) => ({
      threadId: String(t.threadId),
      name: formatTopicLabel(t),
      synthetic: false,
    }));
    const seen = new Set();
    const merged = [general];
    seen.add('1');
    for (const t of fromDb) {
      if (!seen.has(t.threadId)) {
        merged.push(t);
        seen.add(t.threadId);
      }
    }
    return merged;
  }, [bannerIsForum, bannerCachedTopics]);

  useEffect(() => {
    const map = telegramSettings?.chatMap;
    const okleyka = readChatDest(map, 'okleyka.send');
    setOkleykaChatId(okleyka.chatId);
    setOkleykaThreadId(okleyka.threadId);
    const digest = readChatDest(map, 'digest.morning');
    setDigestChatId(digest.chatId);
    setDigestThreadId(digest.threadId);
    const banner = readChatDest(map, 'banner_podryad.evening');
    setBannerChatId(banner.chatId);
    setBannerThreadId(banner.threadId);
  }, [telegramSettings?.chatMap]);

  useEffect(() => {
    if (
      telegramSettings?.bannerPodryadHour == null ||
      telegramSettings.bannerPodryadHour === ''
    ) {
      return;
    }
    setBannerHour(String(telegramSettings.bannerPodryadHour));
  }, [telegramSettings?.bannerPodryadHour]);

  useEffect(() => {
    const s = mentionForwardData?.settings;
    if (!s) return;
    setMentionChatId(s.chatId || '');
    setMentionTopicId(s.topicId != null ? String(s.topicId) : '');
  }, [mentionForwardData?.settings]);

  const mentionForumChats = useMemo(
    () => chats.filter((c) => c.isForum && c.active),
    [chats],
  );
  const { data: mentionTopicsData } = useTelegramTopics(mentionChatId);
  const mentionTopics = mentionTopicsData?.topics ?? [];

  useEffect(() => {
    if (chatsLoading || !okleykaChatId || !selectedChatResolved || !selectedChat) {
      return;
    }
    if (selectedChat.isForum) {
      if (!okleykaThreadId) {
        setOkleykaThreadId('1');
      }
      return;
    }
    setOkleykaThreadId('');
  }, [
    chatsLoading,
    okleykaChatId,
    okleykaThreadId,
    selectedChat,
    selectedChatResolved,
  ]);

  useEffect(() => {
    if (chatsLoading || !digestChatId || !digestSelectedChatResolved || !digestSelectedChat) {
      return;
    }
    if (digestSelectedChat.isForum) {
      if (!digestThreadId) {
        setDigestThreadId('1');
      }
      return;
    }
    setDigestThreadId('');
  }, [
    chatsLoading,
    digestChatId,
    digestThreadId,
    digestSelectedChat,
    digestSelectedChatResolved,
  ]);

  useEffect(() => {
    if (chatsLoading || !bannerChatId || !bannerSelectedChatResolved || !bannerSelectedChat) {
      return;
    }
    if (bannerSelectedChat.isForum) {
      if (!bannerThreadId) {
        setBannerThreadId('1');
      }
      return;
    }
    setBannerThreadId('');
  }, [
    chatsLoading,
    bannerChatId,
    bannerThreadId,
    bannerSelectedChat,
    bannerSelectedChatResolved,
  ]);

  async function saveToken() {
    setSaveError('');
    if (!tokenInput.trim()) {
      setSaveError('Введите токен бота');
      return;
    }
    try {
      await updateTelegramSettings.mutateAsync({ token: tokenInput.trim() });
      setTokenInput('');
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || 'Не удалось сохранить токен');
    }
  }

  async function onTestBot() {
    setActionError('');
    setActionSuccess('');
    try {
      const result = await testTelegramBot.mutateAsync();
      setActionSuccess(result.username ? `@${result.username}` : 'Бот доступен');
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Не удалось проверить бота');
    }
  }

  async function onSetupWebhook() {
    setActionError('');
    setActionSuccess('');
    try {
      await setupWebhook.mutateAsync();
      await refetchWebhook();
      setActionSuccess('Webhook подключён');
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Не удалось подключить webhook');
    }
  }

  async function onTeardownWebhook() {
    setActionError('');
    setActionSuccess('');
    try {
      await teardownWebhook.mutateAsync();
      await refetchWebhook();
      setActionSuccess('Webhook отключён');
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Не удалось отключить webhook');
    }
  }

  async function onAddChat() {
    setActionError('');
    setActionSuccess('');
    const chatId = manualChatId.trim();
    if (!chatId) {
      setActionError('Введите chat_id или @username');
      return;
    }
    try {
      await addChat.mutateAsync({ chatId });
      setManualChatId('');
      setActionSuccess('Чат добавлен');
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Не удалось добавить чат');
    }
  }

  async function onRefreshChats() {
    setActionError('');
    setActionSuccess('');
    try {
      const result = await refreshChats.mutateAsync();
      await refetchChats();
      setActionSuccess(
        `Обновлено: чатов ${result.chats ?? 0}, тем ${result.topics ?? 0}` +
          (result.invited ? `, инвайтов ${result.invited}` : ''),
      );
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Не удалось обновить чаты');
    }
  }

  async function onAddTopic() {
    setActionError('');
    setActionSuccess('');
    const threadId = Number(manualThreadId);
    if (!okleykaChatId) {
      setActionError('Сначала выберите чат');
      return;
    }
    if (!Number.isInteger(threadId) || threadId <= 0) {
      setActionError('Введите положительный thread_id');
      return;
    }
    try {
      await addTopic.mutateAsync({
        chatId: okleykaChatId,
        threadId,
        name: manualTopicName.trim() || undefined,
      });
      setManualThreadId('');
      setManualTopicName('');
      setActionSuccess('Тема добавлена');
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Не удалось добавить тему');
    }
  }

  async function onAddDigestTopic() {
    setActionError('');
    setActionSuccess('');
    const threadId = Number(digestManualThreadId);
    if (!digestChatId) {
      setActionError('Сначала выберите чат');
      return;
    }
    if (!Number.isInteger(threadId) || threadId <= 0) {
      setActionError('Введите положительный thread_id');
      return;
    }
    try {
      await addTopic.mutateAsync({
        chatId: digestChatId,
        threadId,
        name: digestManualTopicName.trim() || undefined,
      });
      setDigestManualThreadId('');
      setDigestManualTopicName('');
      setActionSuccess('Тема добавлена');
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Не удалось добавить тему');
    }
  }

  async function saveOkleykaDest() {
    setSaveError('');
    if (!okleykaChatId) {
      setSaveError('Выберите чат');
      return;
    }
    if (isForum && !okleykaThreadId) {
      setSaveError('Выберите тему форума');
      return;
    }
    const entry = isForum
      ? { chatId: okleykaChatId, threadId: Number(okleykaThreadId || '1') }
      : { chatId: okleykaChatId };
    try {
      await updateTelegramSettings.mutateAsync({
        chatMap: { 'okleyka.send': entry },
      });
      setActionSuccess('Назначение оклейки сохранено');
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || 'Не удалось сохранить назначение');
    }
  }

  async function onTestSend() {
    setActionError('');
    setActionSuccess('');
    try {
      await testTelegramSend.mutateAsync({});
      setActionSuccess('Тестовое сообщение отправлено');
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Не удалось отправить тест');
    }
  }

  async function saveDigestDest() {
    setSaveError('');
    if (!digestChatId) {
      setSaveError('Выберите чат');
      return;
    }
    if (digestIsForum && !digestThreadId) {
      setSaveError('Выберите тему форума');
      return;
    }
    const entry = digestIsForum
      ? { chatId: digestChatId, threadId: Number(digestThreadId || '1') }
      : { chatId: digestChatId };
    try {
      await updateTelegramSettings.mutateAsync({
        chatMap: { 'digest.morning': entry },
      });
      setActionSuccess('Назначение утренней сводки сохранено');
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || 'Не удалось сохранить назначение');
    }
  }

  async function onTestDigestSend() {
    setActionError('');
    setActionSuccess('');
    try {
      await testTelegramSend.mutateAsync({ event: 'digest.morning' });
      setActionSuccess('Тестовое сообщение отправлено');
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Не удалось отправить тест');
    }
  }

  async function onAddBannerTopic() {
    setActionError('');
    setActionSuccess('');
    const threadId = Number(bannerManualThreadId);
    if (!bannerChatId) {
      setActionError('Сначала выберите чат');
      return;
    }
    if (!Number.isInteger(threadId) || threadId <= 0) {
      setActionError('Введите положительный thread_id');
      return;
    }
    try {
      await addTopic.mutateAsync({
        chatId: bannerChatId,
        threadId,
        name: bannerManualTopicName.trim() || undefined,
      });
      setBannerManualThreadId('');
      setBannerManualTopicName('');
      setActionSuccess('Тема добавлена');
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Не удалось добавить тему');
    }
  }

  async function saveBannerDest() {
    setSaveError('');
    const hour = Number(bannerHour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      setSaveError('Час должен быть от 0 до 23');
      return;
    }
    if (!bannerChatId) {
      setSaveError('Выберите чат');
      return;
    }
    if (bannerIsForum && !bannerThreadId) {
      setSaveError('Выберите тему форума');
      return;
    }
    const entry = bannerIsForum
      ? { chatId: bannerChatId, threadId: Number(bannerThreadId || '1') }
      : { chatId: bannerChatId };
    try {
      await updateTelegramSettings.mutateAsync({
        chatMap: { 'banner_podryad.evening': entry },
        bannerPodryadHour: hour,
      });
      setActionSuccess('Назначение баннер/подряд сохранено');
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message || 'Не удалось сохранить назначение');
    }
  }

  async function onTestBannerSend() {
    setActionError('');
    setActionSuccess('');
    try {
      await testTelegramSend.mutateAsync({ event: 'banner_podryad.evening' });
      setActionSuccess('Тестовое сообщение отправлено');
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Не удалось отправить тест');
    }
  }

  async function onSaveMentionForward() {
    setSaveError('');
    setActionError('');
    setActionSuccess('');
    if (mentionChatId && !mentionTopicId) {
      setSaveError('Выберите топик для упоминаний');
      return;
    }
    try {
      await saveMentionForward.mutateAsync({
        chatId: mentionChatId,
        topicId: mentionTopicId ? Number(mentionTopicId) : null,
      });
      setActionSuccess(
        mentionChatId ? 'Пересылка упоминаний включена' : 'Пересылка упоминаний выключена',
      );
    } catch (err) {
      setSaveError(
        err.response?.data?.error || err.message || 'Не удалось сохранить настройки',
      );
    }
  }

  async function onAddAutoInviteMember() {
    setActionError('');
    setActionSuccess('');
    const username = autoInviteUsername.trim();
    const userId = autoInviteUserId.trim();
    const displayName = autoInviteDisplayName.trim();
    if (!username && !userId) {
      setActionError('Укажите username или user_id');
      return;
    }
    try {
      await addAutoInviteMember.mutateAsync({
        username: username || undefined,
        userId: userId || undefined,
        displayName: displayName || undefined,
      });
      setAutoInviteUsername('');
      setAutoInviteUserId('');
      setAutoInviteDisplayName('');
      setActionSuccess('Участник добавлен');
    } catch (err) {
      setActionError(
        err.response?.data?.error || err.message || 'Не удалось добавить участника',
      );
    }
  }

  async function onToggleAutoInviteMember(member) {
    setActionError('');
    setActionSuccess('');
    try {
      await updateAutoInviteMember.mutateAsync({
        id: member.id,
        active: !member.active,
      });
    } catch (err) {
      setActionError(
        err.response?.data?.error || err.message || 'Не удалось обновить участника',
      );
    }
  }

  async function onDeleteAutoInviteMember(id) {
    setActionError('');
    setActionSuccess('');
    try {
      await deleteAutoInviteMember.mutateAsync(id);
      setActionSuccess('Участник удалён');
    } catch (err) {
      setActionError(
        err.response?.data?.error || err.message || 'Не удалось удалить участника',
      );
    }
  }

  async function onRetryAutoInviteRun() {
    setActionError('');
    setActionSuccess('');
    const chatId = retryChatId.trim();
    if (!chatId) {
      setActionError('Введите chat_id');
      return;
    }
    try {
      const result = await retryAutoInviteRun.mutateAsync(chatId);
      const status = result?.status || 'done';
      setActionSuccess(`Повтор запущен: ${status}`);
    } catch (err) {
      setActionError(
        err.response?.data?.error || err.message || 'Не удалось повторить авто-добавление',
      );
    }
  }

  async function onUserbotAuthStart() {
    setActionError('');
    setActionSuccess('');
    const phone = userbotPhone.trim();
    if (!phone) {
      setActionError('Введите номер телефона');
      return;
    }
    try {
      await userbotAuthStart.mutateAsync(phone);
      setUserbotCode('');
      setUserbotPassword('');
      setActionSuccess('Код отправлен в Telegram');
    } catch (err) {
      setActionError(
        err.response?.data?.error || err.message || 'Не удалось отправить код',
      );
    }
  }

  async function onUserbotAuthCode() {
    setActionError('');
    setActionSuccess('');
    const code = userbotCode.trim();
    if (!code) {
      setActionError('Введите код из Telegram');
      return;
    }
    try {
      const result = await userbotAuthCode.mutateAsync(code);
      setUserbotCode('');
      setUserbotPassword('');
      if (result?.pending === 'password') {
        setActionSuccess('Нужен пароль 2FA');
      } else {
        setActionSuccess('User-bot подключён');
      }
    } catch (err) {
      setActionError(
        err.response?.data?.error || err.message || 'Не удалось подтвердить код',
      );
    }
  }

  async function onUserbotAuthPassword() {
    setActionError('');
    setActionSuccess('');
    const password = userbotPassword;
    if (!password) {
      setActionError('Введите пароль двухфакторной аутентификации');
      return;
    }
    try {
      await userbotAuthPassword.mutateAsync(password);
      setUserbotPassword('');
      setActionSuccess('User-bot подключён');
    } catch (err) {
      setActionError(
        err.response?.data?.error || err.message || 'Не удалось войти',
      );
    }
  }

  async function onUserbotAuthCancel() {
    setActionError('');
    setActionSuccess('');
    try {
      await userbotAuthCancel.mutateAsync();
      setUserbotCode('');
      setUserbotPassword('');
      setActionSuccess('Вход отменён');
    } catch (err) {
      setActionError(
        err.response?.data?.error || err.message || 'Не удалось отменить вход',
      );
    }
  }

  async function onUserbotAuthLogout() {
    setActionError('');
    setActionSuccess('');
    try {
      await userbotAuthLogout.mutateAsync();
      setUserbotPhone('');
      setUserbotCode('');
      setUserbotPassword('');
      setActionSuccess('User-bot отключён');
    } catch (err) {
      setActionError(
        err.response?.data?.error || err.message || 'Не удалось выйти',
      );
    }
  }

  const tgWebhook = webhookStatus?.telegram;
  const webhookConnected =
    tgWebhook?.url && webhookStatus?.webhookUrl && tgWebhook.url === webhookStatus.webhookUrl;

  return (
    <div>
      <PageHeader
        title="Telegram"
        description="User-bot для авто-добавления команды в чаты заказов и отправки оклейки. Bot API токен больше не обязателен."
      />

      <Section
        title="Бот (устарело)"
        description="Токен Bot API и webhook больше не нужны для рабочих сценариев. Секция оставлена для совместимости."
      >
        <div className="space-y-4 max-w-2xl">
          {telegramSettings?.tokenSet && (
            <p className="text-sm text-ink-muted">
              Текущий токен:{' '}
              <span className="font-mono text-ink">{telegramSettings.tokenPreview}</span>
            </p>
          )}
          <div>
            <FieldLabel>Токен бота</FieldLabel>
            <div className="flex gap-2 items-center">
              <input
                type="password"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="input-field font-mono flex-1"
                placeholder="123456789:ABC…"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={saveToken}
                disabled={!tokenInput.trim() || updateTelegramSettings.isPending}
                className="btn-primary btn-sm shrink-0"
              >
                Сохранить
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onTestBot}
              disabled={testTelegramBot.isPending}
              className="btn-secondary btn-sm"
            >
              {testTelegramBot.isPending ? 'Проверка…' : 'Проверить бота'}
            </button>
          </div>

          <details className="pt-2 border-t border-border">
            <summary className="text-sm text-ink-muted cursor-pointer select-none">
              Webhook (не используется, свёрнуто)
            </summary>
            <div className="mt-3 space-y-2">
              {webhookLoading ? (
                <p className="text-sm text-ink-muted">Загрузка…</p>
              ) : !webhookStatus?.publicBaseUrlConfigured ? (
                <p className="text-sm text-ink-muted">
                  PUBLIC_BASE_URL не задан на сервере — подключение webhook недоступно.
                </p>
              ) : (
                <div className="space-y-2 text-sm">
                  <p className="text-ink-muted font-mono text-xs break-all">
                    {webhookStatus.webhookUrl || '—'}
                  </p>
                  <p className="text-ink-muted">
                    Секрет: {webhookStatus?.secretSet ? 'задан' : 'не задан'}
                    {webhookConnected && (
                      <span className="ml-2 text-pastel-green-text">· подключён</span>
                    )}
                    {tgWebhook?.last_error_message && (
                      <span className="block mt-1 text-pastel-red-text">
                        Ошибка Telegram: {tgWebhook.last_error_message}
                      </span>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={onSetupWebhook}
                      disabled={setupWebhook.isPending || !telegramSettings?.tokenSet}
                      className="btn-primary btn-sm"
                    >
                      {setupWebhook.isPending ? 'Подключение…' : 'Подключить webhook'}
                    </button>
                    <button
                      type="button"
                      onClick={onTeardownWebhook}
                      disabled={teardownWebhook.isPending || !telegramSettings?.tokenSet}
                      className="btn-secondary btn-sm"
                    >
                      {teardownWebhook.isPending ? 'Отключение…' : 'Отключить webhook'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </details>
        </div>
      </Section>

      <Section
        title="Авто-добавление"
        description="Когда логистика добавляет user-bot в чат заказа, он сам приглашает до 5 человек из списка (старт через 5–15 с после добавления, пауза 3–6 с между приглашениями)."
      >
        <div className="space-y-4">
          <div className="max-w-2xl space-y-4 pb-4 border-b border-border">
            <div>
              <h4 className="text-sm font-semibold text-ink">User-bot</h4>
              <p className="text-xs text-ink-faint mt-1 leading-relaxed">
                Войдите сервисным Telegram-аккаунтом. Логистика добавляет этот аккаунт в чат заказа — остальное делает система.
              </p>
            </div>

            {userbotAuthLoading ? (
              <p className="text-sm text-ink-muted">Загрузка…</p>
            ) : !userbotApiConfigured ? (
              <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
                Задайте TELEGRAM_API_ID и TELEGRAM_API_HASH на сервере (Dokploy / .env).
              </p>
            ) : userbotSessionSet && !userbotPending ? (
              <div className="space-y-3">
                <p className="text-sm text-pastel-green-text bg-pastel-green-bg px-3 py-2 rounded-md">
                  User-bot подключён
                  {userbotUserLabel && (
                    <span className="ml-1.5 font-mono text-ink">{userbotUserLabel}</span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={onUserbotAuthLogout}
                  disabled={userbotAuthLogout.isPending}
                  className="btn-secondary btn-sm"
                >
                  {userbotAuthLogout.isPending ? 'Выход…' : 'Выйти'}
                </button>
              </div>
            ) : userbotPending === 'password' ? (
              <div className="space-y-3 max-w-md">
                <p className="text-sm text-ink-muted">
                  Требуется пароль двухфакторной аутентификации Telegram.
                </p>
                <div>
                  <FieldLabel>Пароль 2FA</FieldLabel>
                  <input
                    type="password"
                    value={userbotPassword}
                    onChange={(e) => setUserbotPassword(e.target.value)}
                    className="input-field w-full"
                    autoComplete="off"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onUserbotAuthPassword}
                    disabled={userbotAuthPassword.isPending}
                    className="btn-primary btn-sm"
                  >
                    {userbotAuthPassword.isPending ? 'Вход…' : 'Войти'}
                  </button>
                  <button
                    type="button"
                    onClick={onUserbotAuthCancel}
                    disabled={userbotAuthCancel.isPending}
                    className="btn-secondary btn-sm"
                  >
                    {userbotAuthCancel.isPending ? 'Отмена…' : 'Отмена'}
                  </button>
                </div>
              </div>
            ) : userbotPending === 'code' ? (
              <div className="space-y-3 max-w-md">
                <p className="text-sm text-ink-muted">
                  Введите код из Telegram (SMS или приложение).
                </p>
                <div>
                  <FieldLabel>Код</FieldLabel>
                  <input
                    type="text"
                    value={userbotCode}
                    onChange={(e) => setUserbotCode(e.target.value)}
                    className="input-field font-mono w-full"
                    placeholder="12345"
                    autoComplete="one-time-code"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onUserbotAuthCode}
                    disabled={userbotAuthCode.isPending}
                    className="btn-primary btn-sm"
                  >
                    {userbotAuthCode.isPending ? 'Проверка…' : 'Подтвердить'}
                  </button>
                  <button
                    type="button"
                    onClick={onUserbotAuthCancel}
                    disabled={userbotAuthCancel.isPending}
                    className="btn-secondary btn-sm"
                  >
                    {userbotAuthCancel.isPending ? 'Отмена…' : 'Отмена'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 max-w-md">
                <div>
                  <FieldLabel>Телефон</FieldLabel>
                  <input
                    type="tel"
                    value={userbotPhone}
                    onChange={(e) => setUserbotPhone(e.target.value)}
                    className="input-field font-mono w-full"
                    placeholder="+79001234567"
                    autoComplete="tel"
                  />
                </div>
                <button
                  type="button"
                  onClick={onUserbotAuthStart}
                  disabled={userbotAuthStart.isPending}
                  className="btn-primary btn-sm"
                >
                  {userbotAuthStart.isPending ? 'Отправка…' : 'Отправить код'}
                </button>
              </div>
            )}
          </div>

          {autoInviteStatusLoading ? (
            <p className="text-sm text-ink-muted">Загрузка…</p>
          ) : !autoInviteConfigured ? (
            <p className="text-sm text-ink-muted">
              Список участников станет доступен после подключения user-bot.
            </p>
          ) : (
            <>
              <p className="text-xs text-ink-faint leading-relaxed max-w-2xl">
                Боту в чатах заказов нужны права Invite users и Add new admins; privacy может
                блокировать инвайт.
              </p>

              {autoInviteMembersLoading ? (
                <p className="text-sm text-ink-muted">Загрузка списка…</p>
              ) : autoInviteMembers.length === 0 ? (
                <p className="text-sm text-ink-muted">Список участников пуст — добавьте первого ниже.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="data-table w-full">
                    <thead>
                      <tr>
                        <th>username</th>
                        <th>user_id</th>
                        <th>Имя</th>
                        <th>Активен</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {autoInviteMembers.map((member) => (
                        <tr key={member.id} className={!member.active ? 'opacity-60' : undefined}>
                          <td className="font-mono text-sm">{member.username ? `@${member.username}` : '—'}</td>
                          <td className="font-mono text-sm">{member.userId || '—'}</td>
                          <td className="text-sm">{member.displayName || '—'}</td>
                          <td>
                            <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                              <input
                                type="checkbox"
                                checked={member.active}
                                onChange={() => onToggleAutoInviteMember(member)}
                                disabled={updateAutoInviteMember.isPending}
                                className="rounded border-border"
                              />
                              {member.active ? 'да' : 'нет'}
                            </label>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => onDeleteAutoInviteMember(member.id)}
                              disabled={deleteAutoInviteMember.isPending}
                              className="btn-secondary btn-sm"
                            >
                              Удалить
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex flex-wrap gap-2 items-end max-w-3xl pt-2">
                <div className="flex-1 min-w-[8rem]">
                  <FieldLabel>username</FieldLabel>
                  <input
                    type="text"
                    value={autoInviteUsername}
                    onChange={(e) => setAutoInviteUsername(e.target.value)}
                    className="input-field font-mono w-full"
                    placeholder="@username"
                  />
                </div>
                <div className="flex-1 min-w-[8rem]">
                  <FieldLabel>user_id</FieldLabel>
                  <input
                    type="text"
                    value={autoInviteUserId}
                    onChange={(e) => setAutoInviteUserId(e.target.value)}
                    className="input-field font-mono w-full"
                    placeholder="123456789"
                  />
                </div>
                <div className="flex-1 min-w-[8rem]">
                  <FieldLabel>Имя (необяз.)</FieldLabel>
                  <input
                    type="text"
                    value={autoInviteDisplayName}
                    onChange={(e) => setAutoInviteDisplayName(e.target.value)}
                    className="input-field w-full"
                    placeholder="Иван"
                  />
                </div>
                <button
                  type="button"
                  onClick={onAddAutoInviteMember}
                  disabled={addAutoInviteMember.isPending}
                  className="btn-primary btn-sm"
                >
                  {addAutoInviteMember.isPending ? 'Добавление…' : 'Добавить'}
                </button>
              </div>

              <div className="flex flex-wrap gap-2 items-end max-w-xl pt-2 border-t border-border">
                <div className="flex-1 min-w-[12rem]">
                  <FieldLabel>Повторить для chat_id</FieldLabel>
                  <input
                    type="text"
                    value={retryChatId}
                    onChange={(e) => setRetryChatId(e.target.value)}
                    className="input-field font-mono w-full"
                    placeholder="-1001234567890"
                  />
                </div>
                <button
                  type="button"
                  onClick={onRetryAutoInviteRun}
                  disabled={retryAutoInviteRun.isPending}
                  className="btn-secondary btn-sm"
                >
                  {retryAutoInviteRun.isPending ? 'Запуск…' : 'Повторить'}
                </button>
              </div>
            </>
          )}
        </div>
      </Section>

      <Section
        title="Чаты"
        description="Список групп, где состоит user-bot. Обновляется автоматически (~30 с) или кнопкой ниже."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <label className="inline-flex items-center gap-2 text-sm text-ink-muted cursor-pointer">
              <input
                type="checkbox"
                checked={!activeOnly}
                onChange={(e) => setActiveOnly(!e.target.checked)}
                className="rounded border-border"
              />
              Показать неактивные
            </label>
            <button
              type="button"
              onClick={onRefreshChats}
              disabled={refreshChats.isPending}
              className="btn-secondary btn-sm"
            >
              {refreshChats.isPending ? 'Обновление…' : 'Обновить чаты из user-bot'}
            </button>
          </div>

          {chatsLoading ? (
            <p className="text-sm text-ink-muted">Загрузка…</p>
          ) : chats.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Чатов пока нет. Добавьте user-bot в группу или нажмите «Обновить чаты из user-bot».
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>chat_id</th>
                    <th>Тип</th>
                    <th>Источник</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {chats.map((chat) => (
                    <tr key={chat.chatId} className={!chat.active ? 'opacity-60' : undefined}>
                      <td>
                        {chat.title || chat.username || '—'}
                        {chat.isForum && (
                          <span className="ml-1.5 text-xs text-ink-faint">форум</span>
                        )}
                      </td>
                      <td className="font-mono text-sm">{chat.chatId}</td>
                      <td className="text-sm text-ink-muted">{chat.type || '—'}</td>
                      <td className="text-sm text-ink-muted">{chat.source || '—'}</td>
                      <td className="text-sm">{chat.active ? 'активен' : 'неактивен'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-end max-w-xl pt-2">
            <div className="flex-1 min-w-[12rem]">
              <FieldLabel>Добавить чат</FieldLabel>
              <input
                type="text"
                value={manualChatId}
                onChange={(e) => setManualChatId(e.target.value)}
                className="input-field font-mono w-full"
                placeholder="-1001234567890 или @username"
              />
            </div>
            <button
              type="button"
              onClick={onAddChat}
              disabled={addChat.isPending}
              className="btn-primary btn-sm"
            >
              {addChat.isPending ? 'Добавление…' : 'Добавить'}
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="Оклейка → отправка"
        description="Куда user-bot отправляет сообщения okleyka.send из Twenty."
      >
        <div className="space-y-4 max-w-xl">
          <div>
            <FieldLabel>Чат</FieldLabel>
            <select
              value={okleykaChatId}
              onChange={(e) => {
                setOkleykaChatId(e.target.value);
                setOkleykaThreadId('');
              }}
              className="select-field w-full"
            >
              <option value="">— выберите чат —</option>
              {okleykaChatOptions.map(({ chat, showInactive }) => (
                <option key={chat.chatId} value={chat.chatId}>
                  {formatChatLabel(chat, { showInactive })}
                </option>
              ))}
            </select>
            {okleykaChatOptions.length === 0 && (
              <p className="text-xs text-ink-faint mt-1.5">
                Нет активных чатов — добавьте бота в группу или введите chat_id вручную выше.
              </p>
            )}
          </div>

          {isForum && (
            <>
              <div>
                <FieldLabel>Тема форума</FieldLabel>
                <select
                  value={okleykaThreadId}
                  onChange={(e) => setOkleykaThreadId(e.target.value)}
                  className="select-field w-full"
                >
                  {topicOptions.map((t) => (
                    <option key={t.threadId} value={t.threadId}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {topicOptions.length <= 1 && (
                  <p className="text-xs text-ink-faint mt-1.5 leading-relaxed">
                    Другие темы появятся после сообщений в форуме или добавьте thread_id вручную ниже.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[6rem]">
                  <FieldLabel>thread_id</FieldLabel>
                  <input
                    type="number"
                    min="1"
                    value={manualThreadId}
                    onChange={(e) => setManualThreadId(e.target.value)}
                    className="input-field font-mono w-full"
                    placeholder="2"
                  />
                </div>
                <div className="flex-[2] min-w-[8rem]">
                  <FieldLabel>Название (необяз.)</FieldLabel>
                  <input
                    type="text"
                    value={manualTopicName}
                    onChange={(e) => setManualTopicName(e.target.value)}
                    className="input-field w-full"
                    placeholder="Оклейка"
                  />
                </div>
                <button
                  type="button"
                  onClick={onAddTopic}
                  disabled={addTopic.isPending}
                  className="btn-secondary btn-sm"
                >
                  Добавить тему
                </button>
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={saveOkleykaDest}
              disabled={updateTelegramSettings.isPending}
              className="btn-primary btn-sm"
            >
              Сохранить назначение
            </button>
            <button
              type="button"
              onClick={onTestSend}
              disabled={testTelegramSend.isPending}
              className="btn-secondary btn-sm"
            >
              {testTelegramSend.isPending ? 'Отправка…' : 'Тест в чат'}
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="Утренняя сводка"
        description="Cron 09:00 и команды /завтра /послезавтра → digest.morning. Omni (🧠): digest_omni_api_key или OMNI_API_KEY; модель oc/deepseek-v4-flash-free, fallback auto. Пока чат не выбран — сводка не отправляется."
      >
        <div className="space-y-4 max-w-xl">
          <div>
            <FieldLabel>Чат</FieldLabel>
            <select
              value={digestChatId}
              onChange={(e) => {
                setDigestChatId(e.target.value);
                setDigestThreadId('');
              }}
              className="select-field w-full"
            >
              <option value="">— выберите чат —</option>
              {digestChatOptions.map(({ chat, showInactive }) => (
                <option key={chat.chatId} value={chat.chatId}>
                  {formatChatLabel(chat, { showInactive })}
                </option>
              ))}
            </select>
            {digestChatOptions.length === 0 && (
              <p className="text-xs text-ink-faint mt-1.5">
                Нет активных чатов — добавьте бота в группу или введите chat_id вручную выше.
              </p>
            )}
          </div>

          {digestIsForum && (
            <>
              <div>
                <FieldLabel>Тема форума</FieldLabel>
                <select
                  value={digestThreadId}
                  onChange={(e) => setDigestThreadId(e.target.value)}
                  className="select-field w-full"
                >
                  {digestTopicOptions.map((t) => (
                    <option key={t.threadId} value={t.threadId}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {digestTopicOptions.length <= 1 && (
                  <p className="text-xs text-ink-faint mt-1.5 leading-relaxed">
                    Другие темы появятся после сообщений в форуме или добавьте thread_id вручную ниже.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[6rem]">
                  <FieldLabel>thread_id</FieldLabel>
                  <input
                    type="number"
                    min="1"
                    value={digestManualThreadId}
                    onChange={(e) => setDigestManualThreadId(e.target.value)}
                    className="input-field font-mono w-full"
                    placeholder="2"
                  />
                </div>
                <div className="flex-[2] min-w-[8rem]">
                  <FieldLabel>Название (необяз.)</FieldLabel>
                  <input
                    type="text"
                    value={digestManualTopicName}
                    onChange={(e) => setDigestManualTopicName(e.target.value)}
                    className="input-field w-full"
                    placeholder="Утренняя сводка"
                  />
                </div>
                <button
                  type="button"
                  onClick={onAddDigestTopic}
                  disabled={addTopic.isPending}
                  className="btn-secondary btn-sm"
                >
                  Добавить тему
                </button>
              </div>
            </>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={saveDigestDest}
              disabled={updateTelegramSettings.isPending}
              className="btn-primary btn-sm"
            >
              Сохранить назначение
            </button>
            <button
              type="button"
              onClick={onTestDigestSend}
              disabled={testTelegramSend.isPending}
              className="btn-secondary btn-sm"
            >
              {testTelegramSend.isPending ? 'Отправка…' : 'Тест в чат'}
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="Баннер/подряд · вечер"
        description="Ежечасный догон и вечерняя пачка → banner_podryad.evening через Bot API. Час (0–23) — когда слать пачку накануне. Пока чат не выбран — пачка не отправляется."
      >
        <div className="space-y-4 max-w-xl">
          <div>
            <FieldLabel>Чат</FieldLabel>
            <select
              value={bannerChatId}
              onChange={(e) => {
                setBannerChatId(e.target.value);
                setBannerThreadId('');
              }}
              className="select-field w-full"
            >
              <option value="">— выберите чат —</option>
              {bannerChatOptions.map(({ chat, showInactive }) => (
                <option key={chat.chatId} value={chat.chatId}>
                  {formatChatLabel(chat, { showInactive })}
                </option>
              ))}
            </select>
            {bannerChatOptions.length === 0 && (
              <p className="text-xs text-ink-faint mt-1.5">
                Нет активных чатов — добавьте бота в группу или введите chat_id вручную выше.
              </p>
            )}
          </div>

          {bannerIsForum && (
            <>
              <div>
                <FieldLabel>Тема форума</FieldLabel>
                <select
                  value={bannerThreadId}
                  onChange={(e) => setBannerThreadId(e.target.value)}
                  className="select-field w-full"
                >
                  {bannerTopicOptions.map((t) => (
                    <option key={t.threadId} value={t.threadId}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {bannerTopicOptions.length <= 1 && (
                  <p className="text-xs text-ink-faint mt-1.5 leading-relaxed">
                    Другие темы появятся после сообщений в форуме или добавьте thread_id вручную ниже.
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="flex-1 min-w-[6rem]">
                  <FieldLabel>thread_id</FieldLabel>
                  <input
                    type="number"
                    min="1"
                    value={bannerManualThreadId}
                    onChange={(e) => setBannerManualThreadId(e.target.value)}
                    className="input-field font-mono w-full"
                    placeholder="2"
                  />
                </div>
                <div className="flex-[2] min-w-[8rem]">
                  <FieldLabel>Название (необяз.)</FieldLabel>
                  <input
                    type="text"
                    value={bannerManualTopicName}
                    onChange={(e) => setBannerManualTopicName(e.target.value)}
                    className="input-field w-full"
                    placeholder="Баннер/подряд"
                  />
                </div>
                <button
                  type="button"
                  onClick={onAddBannerTopic}
                  disabled={addTopic.isPending}
                  className="btn-secondary btn-sm"
                >
                  Добавить тему
                </button>
              </div>
            </>
          )}

          <div>
            <FieldLabel>Час (0–23)</FieldLabel>
            <input
              type="number"
              min="0"
              max="23"
              value={bannerHour}
              onChange={(e) => setBannerHour(e.target.value)}
              className="input-field font-mono w-24"
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={saveBannerDest}
              disabled={updateTelegramSettings.isPending}
              className="btn-primary btn-sm"
            >
              Сохранить назначение
            </button>
            <button
              type="button"
              onClick={onTestBannerSend}
              disabled={testTelegramSend.isPending}
              className="btn-secondary btn-sm"
            >
              {testTelegramSend.isPending ? 'Отправка…' : 'Тест в чат'}
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="Пересылка упоминаний"
        description="Когда user-bot тегают в рабочем чате, сообщение пересылается в выбранный топик общей беседы. Пока чат и топик не выбраны — функция выключена."
      >
        <div className="space-y-4 max-w-xl">
          <div>
            <FieldLabel>Общая беседа (форум)</FieldLabel>
            <select
              value={mentionChatId}
              onChange={(e) => {
                setMentionChatId(e.target.value);
                setMentionTopicId('');
              }}
              className="select-field w-full"
            >
              <option value="">— выключено —</option>
              {mentionForumChats.map((chat) => (
                <option key={chat.chatId} value={chat.chatId}>
                  {formatChatLabel(chat)}
                </option>
              ))}
            </select>
            {mentionForumChats.length === 0 && (
              <p className="text-xs text-ink-faint mt-1.5">
                Нет форум-чатов — беседа с топиками появится в списке после синхронизации.
              </p>
            )}
          </div>

          {mentionChatId && (
            <div>
              <FieldLabel>Топик для упоминаний</FieldLabel>
              <select
                value={mentionTopicId}
                onChange={(e) => setMentionTopicId(e.target.value)}
                className="select-field w-full"
              >
                <option value="">— выберите топик —</option>
                {mentionTopics.map((t) => (
                  <option key={t.threadId} value={String(t.threadId)}>
                    {formatTopicLabel(t)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-ink-faint mt-1.5 leading-relaxed">
                Создайте топик (например «Упоминания») в самой беседе — он появится здесь
                после обновления чатов.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={onSaveMentionForward}
            disabled={saveMentionForward.isPending}
            className="btn-primary btn-sm"
          >
            {saveMentionForward.isPending ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </Section>

      {saveError && (
        <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md mb-4">
          {saveError}
        </p>
      )}
      {actionError && (
        <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md mb-4">
          {actionError}
        </p>
      )}
      {actionSuccess && (
        <p className="text-sm text-pastel-green-text bg-pastel-green-bg px-3 py-2 rounded-md mb-4">
          {actionSuccess}
        </p>
      )}
    </div>
  );
}
