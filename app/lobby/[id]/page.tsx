"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useParams, useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { getDisplayName } from "@/utils/display-name";

type Lobby = {
  id: string;
  game_title?: string;
  lobby_name?: string;
  game_mode?: string;
  current_players?: number;
  max_players?: number;
  platform?: string;
  mic_required?: boolean;
  discord?: string;
  host_id?: string;
  member_ids?: string[];
};

type Profile = {
  id: string;
  email?: string;
  username?: string;
  display_name?: string;
};

type LobbyMessage = {
  id: string;
  lobby_id: string;
  user_id: string;
  user_email?: string;
  message: string;
  created_at: string;
};

const supabase = createClient();

function getDiscordUrl(input: string) {
  const value = input.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:discord\.gg|discord\.com)\//i.test(value)) {
    return `https://${value}`;
  }
  return null;
}

function isDiscordLink(input: string) {
  return /discord\.gg|discord\.com\/invite|https?:\/\//i.test(input);
}

function handleDiscordClick(
  discordInput: string,
  setDiscordModalOpen: (open: boolean) => void,
  setDiscordToast: (message: string | null) => void,
) {
  const value = discordInput.trim();
  if (!value) return;

  if (isDiscordLink(value)) {
    setDiscordModalOpen(true);
    setTimeout(() => {
      window.open(getDiscordUrl(value) ?? value, "_blank");
      setDiscordModalOpen(false);
    }, 1500);
    return;
  }

  navigator.clipboard.writeText(value).then(() => {
    setDiscordToast(`Copied Discord username: ${value}`);
    setTimeout(() => {
      setDiscordToast(null);
    }, 3000);
  });
}

function renderMessageContent(content: string): ReactNode[] {
  const parts = content.split(/(https?:\/\/[^\s]+)/g);
  const rendered: ReactNode[] = [];

  parts.forEach((part, index) => {
    if (!part) return;
    if (!/^https?:\/\//i.test(part)) {
      rendered.push(<span key={`text-${index}`}>{part}</span>);
      return;
    }

    const rawUrl = part;
    const cleanUrl = rawUrl.replace(/[.,!?;:)\]]+$/, "");
    const trailingText = rawUrl.slice(cleanUrl.length);
    const isImage =
      /\.(png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(cleanUrl) ||
      /(?:giphy\.com|tenor\.com)/i.test(cleanUrl);

    rendered.push(
      isImage ? (
        <span className="my-2 block" key={`image-${index}`}>
          <a href={cleanUrl} rel="noreferrer" target="_blank">
            <img
              alt="Shared chat attachment"
              className="max-h-72 max-w-full rounded-lg object-contain"
              loading="lazy"
              src={cleanUrl}
            />
          </a>
        </span>
      ) : (
        <a
          className="text-emerald-400 underline hover:text-emerald-300"
          href={cleanUrl}
          key={`link-${index}`}
          rel="noreferrer"
          target="_blank"
        >
          {cleanUrl}
        </a>
      ),
    );
    if (trailingText) rendered.push(<span key={`trailing-${index}`}>{trailingText}</span>);
  });

  return rendered;
}

export default function SquadPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [messages, setMessages] = useState<LobbyMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<
    { file: File; url: string }[]
  >([]);
  const [discordToast, setDiscordToast] = useState<string | null>(null);
  const [discordModalOpen, setDiscordModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadSquad() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        router.replace("/");
        return;
      }

      const { data: lobbyData, error: lobbyError } = await supabase
        .from("lobbies")
        .select("*")
        .eq("id", id)
        .single();

      if (lobbyError || !lobbyData) {
        if (isMounted) {
          setError(lobbyError?.message ?? "Lobby not found.");
          setLoading(false);
        }
        return;
      }

      const lobbyRecord = lobbyData as Lobby;
      const memberIds = Array.from(
        new Set([lobbyRecord.host_id, ...(lobbyRecord.member_ids ?? [])].filter(Boolean)),
      ) as string[];
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .in("id", memberIds);

      const { data: messageData, error: messageError } = await supabase
        .from("lobby_messages")
        .select("*")
        .eq("lobby_id", id)
        .order("created_at", { ascending: true });

      if (!isMounted) return;

      setUser(userData.user);
      setLobby(lobbyRecord);
      setProfiles((profileData ?? []) as Profile[]);
      setMessages((messageData ?? []) as LobbyMessage[]);
      setError(
        profileError?.message ?? messageError?.message ?? null,
      );
      setLoading(false);
    }

    void loadSquad();
    return () => {
      isMounted = false;
    };
  }, [id, router]);

  useEffect(() => {
    if (!params.id) return;

    const channel = supabase
      .channel(`room-${params.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "lobby_messages",
          filter: `lobby_id=eq.${params.id}`,
        },
        (payload) => {
          const newMsg = payload.new as LobbyMessage;
          setMessages((prev) => {
            if (prev.some((message) => message.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
        },
      )
      .subscribe((status) => {
        console.log("Realtime status:", status);
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [params.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !id || (!messageInput.trim() && attachments.length === 0)) return;

    setSending(true);
    setIsUploading(attachments.length > 0);
    setError(null);

    try {
      const attachmentUrls: string[] = [];
      for (const file of attachments) {
        const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const filePath = `${id}/${crypto.randomUUID()}-${safeFileName}`;
        const { error: uploadError } = await supabase.storage
          .from("chat-attachments")
          .upload(filePath, file, { cacheControl: "3600", upsert: false });
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from("chat-attachments")
          .getPublicUrl(filePath);
        attachmentUrls.push(publicUrlData.publicUrl);
      }

      const messageText = [messageInput.trim(), ...attachmentUrls]
        .filter(Boolean)
        .join("\n");
      const { error: sendError } = await supabase.from("lobby_messages").insert({
        lobby_id: id,
        user_id: user.id,
        user_email: user.email,
        message: messageText,
      });

      if (sendError) throw sendError;
      setMessageInput("");
      setAttachments([]);
      attachmentPreviews.forEach((preview) => URL.revokeObjectURL(preview.url));
      setAttachmentPreviews([]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : JSON.stringify(sendError));
    } finally {
      setIsUploading(false);
      setSending(false);
    }
  }

  function addAttachmentFiles(files: File[]) {
    const filesToAdd = files.filter((file) =>
      file.type.startsWith("image/"),
    );
    setAttachments((previous) => [...previous, ...filesToAdd]);
    setAttachmentPreviews((previous) => [
      ...previous,
      ...filesToAdd.map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
  }

  function handleFileChange(newFiles: FileList | null) {
    if (!newFiles) return;
    addAttachmentFiles(Array.from(newFiles));
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    handleFileChange(event.target.files);
    event.target.value = "";
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    for (const item of Array.from(event.clipboardData.items)) {
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (!file) continue;
      event.preventDefault();
      addAttachmentFiles([file]);
      return;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  if (loading) {
    return <main className="min-h-screen bg-zinc-950 p-8 text-zinc-400">Loading squad...</main>;
  }

  if (!lobby) {
    return (
      <main className="min-h-screen bg-zinc-950 p-8 text-red-400">
        {error ?? "Lobby not found."}
      </main>
    );
  }

  const memberIds = Array.from(
    new Set([lobby.host_id, ...(lobby.member_ids ?? [])].filter(Boolean)),
  ) as string[];

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0d14] px-4 py-5 text-zinc-100 sm:px-8 lg:px-12">
      <div className="pointer-events-none absolute -left-40 top-0 h-[32rem] w-[32rem] rounded-full bg-indigo-600/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-32 bottom-0 h-[28rem] w-[28rem] rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="relative mx-auto flex max-w-7xl gap-4 lg:gap-6">
        <aside className="hidden h-fit shrink-0 flex-col items-center gap-5 rounded-2xl border border-white/10 bg-white/5 px-3 py-5 backdrop-blur-md sm:flex">
          <button aria-label="Back to lobbies" className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-500/20 text-lg text-indigo-200 transition hover:bg-indigo-500/40" onClick={() => router.push("/")} title="Back to lobbies" type="button">⌂</button>
          <div className="h-px w-6 bg-white/10" />
          <span aria-hidden="true" className="text-xl text-zinc-500">◈</span>
          <span aria-hidden="true" className="text-xl text-indigo-300">◌</span>
          <span aria-hidden="true" className="text-xl text-zinc-500">⚙</span>
        </aside>

        <div className="min-w-0 flex-1 rounded-3xl border border-white/10 bg-zinc-900/40 p-4 shadow-2xl backdrop-blur-xl sm:p-6 lg:p-8">
          <header className="relative mb-6 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-6 sm:px-7">
            <div className="absolute right-4 top-1/2 grid h-24 w-24 -translate-y-1/2 place-items-center rounded-3xl border border-indigo-300/20 bg-indigo-500/10 text-4xl text-indigo-200 shadow-[0_0_45px_rgba(99,102,241,0.18)] sm:right-8">
              ◇
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-indigo-300">{lobby.game_title ?? "Squad room"}</p>
            <h1 className="mt-2 max-w-[calc(100%-7rem)] text-3xl font-semibold tracking-tight text-white sm:text-4xl">{lobby.lobby_name ?? "Untitled lobby"}</h1>
            <p className="mt-3 text-sm text-zinc-400">{lobby.game_mode ?? "Ranked"} <span className="mx-2 text-zinc-600">•</span> {Number(lobby.current_players ?? 0)} / {Number(lobby.max_players ?? 0)} players</p>
          </header>

          {error && <p className="mb-5 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-300">{error}</p>}
          <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
            <section className="h-[540px] rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <div><p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500"><span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />{"// SQUAD_ROSTER"}</p><h2 className="mt-1 text-xl font-semibold">Teammates</h2></div>
                <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-medium text-amber-200">Gold 2</span>
              </div>
              <ul className="mt-6 space-y-2">
                {memberIds.map((memberId) => {
                  const profile = profiles.find((candidate) => candidate.id === memberId);
                  return <li className="flex items-center justify-between rounded-xl border border-white/5 bg-black/10 px-3 py-3" key={memberId}>
                    <div className="flex min-w-0 items-center gap-3"><span className="relative h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]"><span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/50" /></span><span className="truncate text-sm font-medium">{getDisplayName(profile, memberId)}</span></div>
                    <span className="ml-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{memberId === lobby.host_id ? "Host" : "Member"}</span>
                  </li>;
                })}
              </ul>
              <div className="mt-6 flex flex-wrap gap-2"><span className="rounded-full bg-indigo-400/10 px-3 py-1 text-xs text-indigo-200">Ranked</span><span className="rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-400">Chill comms</span></div>
              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-5 text-sm"><div><dt className="text-xs text-zinc-500">Voice</dt><dd className="mt-1 text-zinc-200">{lobby.mic_required ? "Mic required" : "Mic optional"}</dd></div><div><dt className="text-xs text-zinc-500">Platform</dt><dd className="mt-1 text-zinc-200">{lobby.platform ?? "Any"}</dd></div><div><dt className="text-xs text-zinc-500">Region</dt><dd className="mt-1 text-zinc-200">Global</dd></div><div><dt className="text-xs text-zinc-500">Discord</dt><dd className="mt-1 max-w-full truncate text-zinc-200">{lobby.discord ?? "Not provided"}</dd></div></dl>
              {lobby.discord ? <button className="mt-6 w-full rounded-xl border border-indigo-400/30 bg-indigo-500/20 px-4 py-3 text-sm font-semibold text-indigo-100 shadow-[0_0_20px_rgba(99,102,241,0.08)] transition-all hover:border-indigo-300/60 hover:bg-indigo-500/35 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)]" onClick={() => handleDiscordClick(lobby.discord ?? "", setDiscordModalOpen, setDiscordToast)} type="button">{isDiscordLink(lobby.discord) ? "Join Discord Server" : `Copy Discord Tag (${lobby.discord})`}</button> : <span className="mt-6 block w-full rounded-xl border border-white/10 px-4 py-3 text-center text-sm text-zinc-500">No Discord Provided</span>}
            </section>

            <section className="h-[540px] min-h-0 flex flex-col glass-panel rounded-3xl p-5">
              <div className="shrink-0"><p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500"><span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />{"// LIVE_CHANNEL"}</p><h2 className="mt-1 text-xl font-semibold">Squad Chat</h2><p className="mt-1 text-sm text-zinc-500">Coordinate your next match.</p></div>
              <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto border-y border-white/10 pr-2 py-5 [scrollbar-color:#52525b_transparent] [scrollbar-width:thin]">
                {messages.length === 0 && <p className="text-sm text-zinc-500">No messages yet. Start the strategy.</p>}
                {messages.map((chatMessage) => { const isCurrentUser = chatMessage.user_id === user?.id; const profile = profiles.find((candidate) => candidate.id === chatMessage.user_id); return <article className={`flex max-w-[92%] ${isCurrentUser ? "ml-auto justify-end" : "mr-auto justify-start"}`} key={chatMessage.id}><div className={`w-fit max-w-full rounded-2xl p-3 ${isCurrentUser ? "rounded-tr-none border border-indigo-500/40 bg-indigo-600/30 text-white shadow-[0_0_15px_rgba(99,102,241,0.15)]" : "rounded-tl-none border border-white/10 bg-white/5 text-zinc-200"}`}><div className="flex items-center justify-between gap-3"><p className="truncate text-xs font-semibold text-indigo-200">{getDisplayName(profile ?? { email: chatMessage.user_email }, chatMessage.user_id)}</p><time className="shrink-0 text-[10px] text-zinc-500" dateTime={chatMessage.created_at}>{new Date(chatMessage.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div><div className="mt-2 whitespace-pre-wrap text-sm leading-6">{renderMessageContent(chatMessage.message)}</div></div></article>; })}
                <div ref={messagesEndRef} />
              </div>
              <form className="mt-auto flex shrink-0 items-end gap-2 border-t border-white/10 pt-3" onSubmit={handleSendMessage}>
                <input accept="image/*,.gif" className="hidden" onChange={handleFileInputChange} ref={fileInputRef} type="file" />
                <div className="min-w-0 flex-1">{attachmentPreviews.length > 0 && <div className="mb-2 flex gap-2 overflow-x-auto">{attachmentPreviews.map((preview) => <div className="relative shrink-0" key={`${preview.file.name}-${preview.file.lastModified}`}><img alt={`Preview of ${preview.file.name}`} className="h-14 w-14 rounded-lg object-cover" src={preview.url} /><button aria-label={`Remove ${preview.file.name}`} className="absolute right-0 top-0 rounded-bl bg-zinc-950/80 px-1 text-xs text-white" onClick={() => { URL.revokeObjectURL(preview.url); setAttachments((current) => current.filter((file) => file !== preview.file)); setAttachmentPreviews((current) => current.filter((item) => item.file !== preview.file)); }} type="button">×</button></div>)}</div>}<textarea className="min-h-11 w-full resize-none rounded-full border border-white/10 bg-zinc-900/80 px-5 py-2.5 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-indigo-400/60" onChange={(event) => setMessageInput(event.target.value || "")} onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder="Message your squad" rows={1} value={messageInput} /></div>
                <button aria-label="Attach image or GIF" className="rounded-full border border-white/10 px-3 py-2.5 text-xs text-zinc-400 transition-all hover:border-emerald-400/60 hover:text-indigo-200 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:cursor-wait disabled:opacity-50" disabled={isUploading || sending} onClick={() => fileInputRef.current?.click()} title={isUploading ? "Uploading attachment" : "Attach image or GIF"} type="button">{isUploading ? "..." : "Attach"}</button>
                <button className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all hover:border hover:border-emerald-400/60 hover:from-indigo-400 hover:to-violet-400 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50" disabled={sending || isUploading || (!messageInput.trim() && attachments.length === 0)} type="submit">{sending ? "Sending..." : "Send"}</button>
              </form>
            </section>
          </div>
        </div>
      </div>

      {discordModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md"
          role="presentation"
        >
          <div
            aria-labelledby="discord-modal-title"
            aria-modal="true"
            className="w-full max-w-md border border-zinc-700 bg-zinc-900 p-8 shadow-2xl"
            role="dialog"
          >
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold" id="discord-modal-title">
                Redirecting to Discord Server...
              </h2>
            </div>
            <div className="mt-6 flex justify-center" aria-label="Loading" role="status">
              <span className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-[#5865F2]" />
            </div>
          </div>
        </div>
      )}

      {discordToast && (
        <div
          aria-live="polite"
          className="fixed bottom-5 right-5 z-50 border border-[#5865F2]/60 bg-zinc-900 px-4 py-3 text-sm text-white shadow-xl"
          role="status"
        >
          <span className="mr-2 text-green-400">✓</span>
          {discordToast}
        </div>
      )}
    </main>
  );
}
