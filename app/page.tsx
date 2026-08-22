"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

type Lobby = Record<string, unknown> & {
  id?: string | number;
  game_title?: string;
  lobby_name?: string;
  game_mode?: string;
  current_players?: number;
  max_players?: number;
  platform?: string;
  mic_required?: boolean;
  discord?: string;
  member_ids?: string[];
  host_id?: string;
};

const supabase = createClient();

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function formatError(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }

  return JSON.stringify(error) || "An unexpected error occurred.";
}

function getDiscordUrl(input: string) {
  const value = input.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:discord\.gg|discord\.com)\//i.test(value)) {
    return `https://${value}`;
  }
  return `https://discord.com/users/${encodeURIComponent(value)}`;
}

async function handleDiscordClick(discordInput: string, notify: (message: string) => void) {
  const value = discordInput.trim();
  if (!value) return;

  const isInvite = /discord\.gg|discord\.com\/invite|^https?:\/\//i.test(value);
  if (isInvite) {
    window.open(getDiscordUrl(value) ?? value, "_blank");
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    notify(`Copied Discord username '${value}' to clipboard!`);
    window.open("https://discord.com/channels/@me", "_blank");
  } catch (copyError) {
    const message = formatError(copyError);
    console.error(message);
    notify(message);
  }
}

export default function Home() {
  const router = useRouter();
  const [lobbies, setLobbies] = useState<Lobby[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isHostModalOpen, setIsHostModalOpen] = useState(false);
  const [game_name, setGameName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState("");
  const [platform, setPlatform] = useState("");
  const [max_squad_size, setMaxSquadSize] = useState(4);
  const [mic_required, setMicRequired] = useState(false);
  const [discord, setDiscord] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingLobbyId, setDeletingLobbyId] = useState<string | number | null>(
    null,
  );
  const [lobbyPendingDeletion, setLobbyPendingDeletion] = useState<Lobby | null>(
    null,
  );
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [joiningLobbyId, setJoiningLobbyId] = useState<string | number | null>(
    null,
  );
  const toast = {
    error: (message: string) => setToastMessage(message),
  };

  useEffect(() => {
    let isMounted = true;

    async function fetchLobbies() {
      const { data, error: queryError } = await supabase
        .from("lobbies")
        .select("*")
        .order("created_at", { ascending: false });

      if (!isMounted) return;

      if (queryError) {
        setError(formatError(queryError));
      } else {
        setLobbies((data ?? []) as Lobby[]);
        setError(null);
      }
      setLoading(false);
    }

    void fetchLobbies();

    const channel = supabase
      .channel("active-lobbies")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lobbies" },
        () => void fetchLobbies(),
      )
      .subscribe();

    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadUserProfile(currentUser: User | null) {
      if (!isMounted) return;

      setUser(currentUser);
      if (!currentUser) {
        setRole(null);
        return;
      }

      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", currentUser.id)
        .maybeSingle();

      if (!isMounted) return;

      if (profileError) {
        setError(formatError(profileError));
        setRole(null);
        return;
      }

      setRole(typeof data?.role === "string" ? data.role : null);
    }

    void supabase.auth.getUser().then(({ data, error: userError }) => {
      if (userError) {
        setError(formatError(userError));
        return;
      }
      void loadUserProfile(data.user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => void loadUserProfile(session?.user ?? null), 0);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const { error: insertError } = await supabase.from("lobbies").insert({
        host_id: user.id,
        game_title: game_name,
        lobby_name: description,
        game_mode: mode,
        platform,
        mic_required: Boolean(mic_required),
        max_players: Number(max_squad_size),
        current_players: 1,
        status: "active",
        discord: discord.trim(),
      });

      if (insertError) throw insertError;

      const { data: refreshedLobbies, error: refreshError } = await supabase
        .from("lobbies")
        .select("*")
        .order("created_at", { ascending: false });

      if (refreshError) throw refreshError;

      setLobbies((refreshedLobbies ?? []) as Lobby[]);
      setGameName("");
      setDescription("");
      setMode("");
      setPlatform("");
      setMaxSquadSize(4);
      setMicRequired(false);
      setDiscord("");
      setIsHostModalOpen(false);
    } catch (caughtError) {
      const message = formatError(caughtError);
      console.error(message);
      setError(message);
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsAuthenticating(true);
    setError(null);

    if (authTab === "login") {
      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });

      setIsAuthenticating(false);

      if (loginError) {
        setError(formatError(loginError));
        return;
      }

      setAuthEmail("");
      setAuthPassword("");
      setIsAuthModalOpen(false);
      return;
    }

    const { data, error: signupError } = await supabase.auth.signUp({
      email: authEmail,
      password: authPassword,
    });

    setIsAuthenticating(false);

    if (signupError) {
      const signupMessage = formatError(signupError);
      const isExistingAccount = /already registered|already exists/i.test(
        signupMessage,
      );
      setError(
        isExistingAccount
          ? "An account with this email already exists. Please log in instead."
          : signupMessage,
      );
      if (isExistingAccount) setAuthTab("login");
      return;
    }

    if (data.user && data.user.identities?.length === 0) {
      setError("An account with this email already exists. Please switch to Log In.");
      setAuthTab("login");
      return;
    }

    if (!(data.user && (data.user.identities?.length ?? 0) > 0)) {
      setError("Unable to create your account. Please try again.");
      return;
    }

    setAuthPassword("");
    setIsSubmitted(true);
  }

  async function handleResendEmail() {
    if (!authEmail) return;

    setIsResending(true);
    setError(null);
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: authEmail,
    });
    setIsResending(false);

    if (resendError) {
      setError(resendError.message);
    }
  }

  async function handleDelete(lobby: Lobby) {
    if (
      (user?.id !== lobby.host_id && role !== "admin") ||
      lobby.id === undefined ||
      lobby.id === null
    ) {
      return;
    }

    setDeletingLobbyId(lobby.id);

    try {
      const { error: deleteError } = await supabase
        .from("lobbies")
        .delete()
        .eq("id", lobby.id);

      if (deleteError) {
        const message = formatError(deleteError);
        console.error(message);
        toast.error(message);
        setError(message);
        return;
      }

      setLobbies((currentLobbies) =>
        currentLobbies.filter((currentLobby) => currentLobby.id !== lobby.id),
      );
    } catch (caughtError) {
      const message = formatError(caughtError);
      console.error(message);
      toast.error(message);
      setError(message);
    } finally {
      setDeletingLobbyId(null);
      setLobbyPendingDeletion(null);
    }
  }

  async function handleJoin(lobby: Lobby) {
    if (!user || lobby.id === undefined || lobby.id === null) return;
    if (user.id === lobby.host_id) {
      setJoinError("You are already the host of this lobby.");
      return;
    }

    const memberIds = lobby.member_ids || [];
    if (memberIds.includes(user.id)) {
      router.push(`/lobby/${lobby.id}`);
      return;
    }

    const currentPlayers = Number(lobby.current_players || 1);
    const maxPlayers = Number(lobby.max_players || 0);
    if (
      !Number.isFinite(currentPlayers) ||
      !Number.isFinite(maxPlayers) ||
      currentPlayers >= maxPlayers
    ) {
      setJoinError("This squad is already full.");
      return;
    }

    const nextPlayers = Number(lobby.current_players || 1) + 1;
    const nextMemberIds = [...(lobby.member_ids || []), user.id];
    const previousLobbies = lobbies;
    setJoinError(null);
    setJoiningLobbyId(lobby.id);
    setLobbies((currentLobbies) =>
      currentLobbies.map((currentLobby) =>
        currentLobby.id === lobby.id
          ? {
              ...currentLobby,
              current_players: nextPlayers,
              member_ids: nextMemberIds,
            }
          : currentLobby,
      ),
    );

    try {
      const { error: updateError } = await supabase
        .from("lobbies")
        .update({
          current_players: nextPlayers,
          member_ids: nextMemberIds,
        })
        .eq("id", lobby.id)
        .lt("current_players", maxPlayers);

      if (updateError) throw updateError;
      router.push(`/lobby/${lobby.id}`);
    } catch (caughtError) {
      setLobbies(previousLobbies);
      const message = formatError(caughtError);
      console.error(message);
      setJoinError(message);
    } finally {
      setJoiningLobbyId(null);
    }
  }

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredLobbies = lobbies.filter((lobby) => {
    if (!normalizedSearchTerm) return true;

    return [
      (lobby.game_title || "").toLowerCase(),
      (lobby.lobby_name || "").toLowerCase(),
      (lobby.game_mode || "").toLowerCase(),
      (lobby.platform || "").toLowerCase(),
    ].some((value) => value.includes(normalizedSearchTerm));
  });

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-16 text-zinc-100 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex items-end justify-between gap-6 border-b border-zinc-800 pb-6">
          <div>
            <p className="mb-3 text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
              Gamer LFG
            </p>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Find your next squad.
            </h1>
          </div>
          <div className="flex items-center gap-5">
            <p className="hidden text-right text-sm text-zinc-400 sm:block">
              Live active lobbies
              <br />
              <span className="text-emerald-400">Connected</span>
            </p>
            <button
              className="bg-emerald-400 px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-300"
              onClick={() => {
                if (user) {
                  setIsHostModalOpen(true);
                } else {
                  setAuthTab("login");
                  setIsSubmitted(false);
                  setIsAuthModalOpen(true);
                }
              }}
              type="button"
            >
              Host Lobby
            </button>
            {user ? (
              <div className="flex items-center gap-3 text-sm">
                <div className="hidden text-right sm:block">
                  <p className="max-w-[180px] truncate text-zinc-300">{user.email}</p>
                  <span className="inline-flex border border-emerald-400/50 px-2 py-0.5 text-xs text-emerald-400">
                    {role === "admin" ? "Admin" : "Member"}
                  </span>
                </div>
                <button
                  className="border border-zinc-700 px-3 py-2 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                  onClick={() => void supabase.auth.signOut()}
                  type="button"
                >
                  Log Out
                </button>
              </div>
            ) : (
              <button
                className="border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                onClick={() => {
                  setAuthTab("login");
                  setIsSubmitted(false);
                  setIsAuthModalOpen(true);
                }}
                type="button"
              >
                Log In
              </button>
            )}
          </div>
        </header>

        {!user ? (
          <section className="relative overflow-hidden border border-zinc-800 bg-zinc-900 px-6 py-20 sm:px-12 sm:py-28">
            <div className="relative max-w-3xl">
              <p className="mb-5 text-sm font-medium uppercase tracking-[0.3em] text-emerald-400">
                Your party is waiting
              </p>
              <h2 className="max-w-2xl text-5xl font-semibold uppercase tracking-tight text-white sm:text-7xl">
                GAMER LFG
              </h2>
              <p className="mt-5 max-w-xl text-2xl font-medium leading-tight text-zinc-200 sm:text-3xl">
                Find Your Next Squad. Elevate Your Game.
              </p>
              <p className="mt-6 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
                Gamer LFG connects competitive and casual gamers across titles
                like Valorant, Call of Duty, and Apex Legends. Find teammates
                with matching ranks, voice chat preferences, and regions.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <button
                  className="bg-emerald-400 px-6 py-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-300"
                  onClick={() => {
                    setAuthTab("login");
                    setIsSubmitted(false);
                    setIsAuthModalOpen(true);
                  }}
                  type="button"
                >
                  Sign In
                </button>
                <button
                  className="border border-zinc-600 px-6 py-4 text-sm font-semibold text-zinc-100 transition-colors hover:border-emerald-400 hover:text-emerald-400"
                  onClick={() => {
                    setAuthTab("signup");
                    setIsSubmitted(false);
                    setIsAuthModalOpen(true);
                  }}
                  type="button"
                >
                  Create Account
                </button>
              </div>
            </div>
          </section>
        ) : (
          <>
            {loading && <p className="text-zinc-400">Loading active lobbies...</p>}
            {error && <p className="text-red-400">Could not load lobbies: {error}</p>}
            {joinError && <p className="text-red-400">Could not join squad: {joinError}</p>}
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="sr-only" htmlFor="lobby-search">
                Search lobbies
              </label>
              <input
                className="w-full border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500 focus:border-emerald-400 sm:max-w-md"
                id="lobby-search"
                onChange={(event) => setSearchTerm(event.target.value || "")}
                placeholder="Search by game, lobby, mode, or platform"
                type="search"
                value={searchTerm}
              />
              <p className="text-sm text-zinc-500">
                {filteredLobbies.length} {filteredLobbies.length === 1 ? "lobby" : "lobbies"}
              </p>
            </div>
            {!loading && !error && filteredLobbies.length === 0 && (
              <p className="text-zinc-400">
                {searchTerm ? "No lobbies match your search." : "No active lobbies yet."}
              </p>
            )}

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
          {filteredLobbies.map((lobby, index) => {
            const gameTitle = stringValue(lobby.game_title, "Untitled game");
            const lobbyName = stringValue(lobby.lobby_name, "Untitled lobby");
            const discordValue = stringValue(lobby.discord, "");
            const discordUrl = getDiscordUrl(discordValue);
            const currentPlayers = Number(lobby.current_players ?? 0);
            const maxPlayers = Number(lobby.max_players ?? 0);
            const isSquadFull = currentPlayers >= maxPlayers;
            const hasJoined = user
              ? (Array.isArray(lobby.member_ids) ? lobby.member_ids : []).includes(
                  user.id,
                )
              : false;
            const isHost = user?.id === lobby.host_id;
            const canDelete = isHost || role === "admin";

            return (
              <article
                className="border border-zinc-800 bg-zinc-900 p-5 transition-colors hover:border-emerald-500/60"
                key={String(lobby.id ?? `${gameTitle}-${lobbyName}-${index}`)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-400">
                      {gameTitle}
                    </p>
                    <h2 className="mt-1 text-xl font-semibold">{lobbyName}</h2>
                  </div>
                  {canDelete && (
                    <button
                      aria-label={`Delete ${lobbyName}`}
                      className="text-sm text-red-400 transition-colors hover:text-red-300 disabled:cursor-wait disabled:opacity-50"
                      disabled={deletingLobbyId === lobby.id}
                      onClick={() => setLobbyPendingDeletion(lobby)}
                      type="button"
                    >
                      {deletingLobbyId === lobby.id ? "Deleting..." : "Delete"}
                    </button>
                  )}
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Mode</dt>
                    <dd>{stringValue(lobby.game_mode, "Any")}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Squad Size</dt>
                    <dd>
                      {lobby.current_players ?? 0} / {lobby.max_players ?? 0} Slots
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Platform</dt>
                    <dd>{stringValue(lobby.platform, "Any")}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Voice</dt>
                    <dd>{lobby.mic_required ? "Mic Required" : "No Mic"}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Discord</dt>
                    <dd className="max-w-[65%] truncate text-right">
                      {discordValue || "Not provided"}
                    </dd>
                  </div>
                </dl>
                <div className="mt-6 space-y-3">
                  {discordUrl ? (
                    <button
                      className="block border border-[#5865F2] px-4 py-2 text-center text-sm text-[#9aa5ff] transition-colors hover:bg-[#5865F2] hover:text-white"
                      onClick={() => void handleDiscordClick(discordValue, setToastMessage)}
                      type="button"
                    >
                      {/^https?:\/\//i.test(discordValue) || /discord\.gg|discord\.com\/invite/i.test(discordValue)
                        ? "Join Discord Server"
                        : `Copy Discord Tag (${discordValue})`}
                    </button>
                  ) : (
                    <span className="block border border-zinc-700 px-4 py-2 text-center text-sm text-zinc-500">
                      No Discord Provided
                    </span>
                  )}
                  {isHost || hasJoined ? (
                    <button
                      className="block w-full border border-emerald-400/50 px-4 py-3 text-sm font-semibold text-emerald-400 transition-colors hover:bg-emerald-400 hover:text-zinc-950"
                      onClick={() => router.push(`/lobby/${lobby.id}`)}
                      type="button"
                    >
                      View Squad
                    </button>
                  ) : isSquadFull ? (
                    <span className="block bg-zinc-700 px-4 py-3 text-center text-sm font-semibold text-zinc-400">
                      Squad Full
                    </span>
                  ) : (
                    <button
                      className="block w-full bg-emerald-400 px-4 py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
                      disabled={joiningLobbyId === lobby.id}
                      onClick={() => {
                        void handleJoin(lobby);
                      }}
                      type="button"
                    >
                      {hasJoined
                        ? "View Squad"
                        : joiningLobbyId === lobby.id
                          ? "Joining..."
                          : "Join Squad"}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
            </section>
          </>
        )}
      </div>

      {lobbyPendingDeletion && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-6 py-10"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingLobbyId) {
              setLobbyPendingDeletion(null);
            }
          }}
        >
          <div
            aria-labelledby="delete-lobby-title"
            aria-modal="true"
            className="w-full max-w-md border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            role="dialog"
          >
            <h2 className="text-xl font-semibold" id="delete-lobby-title">
              Delete lobby?
            </h2>
            <p className="mt-4 text-sm leading-6 text-zinc-400">
              Are you sure you want to permanently delete this lobby?
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="border border-zinc-700 px-4 py-3 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
                disabled={Boolean(deletingLobbyId)}
                onClick={() => setLobbyPendingDeletion(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="bg-red-500 px-4 py-3 text-sm font-semibold text-white hover:bg-red-400 disabled:cursor-wait disabled:opacity-60"
                disabled={Boolean(deletingLobbyId)}
                onClick={() => void handleDelete(lobbyPendingDeletion)}
                type="button"
              >
                {deletingLobbyId ? "Deleting..." : "Delete Lobby"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && (
        <div
          aria-live="assertive"
          className="fixed bottom-6 right-6 z-40 max-w-sm border border-red-400/60 bg-red-950 px-4 py-3 text-sm text-red-100 shadow-xl"
          role="alert"
        >
          <div className="flex items-start gap-4">
            <span>{toastMessage}</span>
            <button
              aria-label="Dismiss notification"
              className="text-red-300 hover:text-white"
              onClick={() => setToastMessage(null)}
              type="button"
            >
              x
            </button>
          </div>
        </div>
      )}

      {isAuthModalOpen && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/70 px-6 py-10"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsAuthModalOpen(false);
          }}
        >
          <div
            aria-labelledby="auth-title"
            aria-modal="true"
            className="w-full max-w-md border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            role="dialog"
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
                  Account
                </p>
                <h2 className="mt-2 text-2xl font-semibold" id="auth-title">
                  {authTab === "login" ? "Welcome back" : "Create your account"}
                </h2>
              </div>
              <button
                aria-label="Close authentication modal"
                className="text-2xl leading-none text-zinc-400 hover:text-white"
                onClick={() => setIsAuthModalOpen(false)}
                type="button"
              >
                x
              </button>
            </div>
            {!isSubmitted && (
              <div className="mb-6 grid grid-cols-2 border-b border-zinc-700">
              <button
                className={`border-b-2 px-3 py-3 text-sm font-semibold ${authTab === "login" ? "border-emerald-400 text-emerald-400" : "border-transparent text-zinc-500"}`}
                onClick={() => {
                  setIsSubmitted(false);
                  setAuthTab("login");
                }}
                type="button"
              >
                Log In
              </button>
              <button
                className={`border-b-2 px-3 py-3 text-sm font-semibold ${authTab === "signup" ? "border-emerald-400 text-emerald-400" : "border-transparent text-zinc-500"}`}
                onClick={() => {
                  setIsSubmitted(false);
                  setAuthTab("signup");
                }}
                type="button"
              >
                Sign Up
              </button>
              </div>
            )}
            {isSubmitted ? (
              <div className="border border-emerald-400/40 bg-emerald-950/30 p-6">
                <div className="mb-5 flex h-12 w-12 items-center justify-center border border-emerald-400/50 text-2xl text-emerald-400" aria-hidden="true">
                  ✉
                </div>
                <h3 className="text-2xl font-semibold text-white">
                  Welcome to Gamer LFG! 🎮
                </h3>
                <p className="mt-4 text-sm leading-6 text-zinc-300">
                  Thank you for creating an account and joining the Gamer LFG community. By creating your profile, you are directly helping gamers everywhere connect, assemble squads, and find their perfect gaming teams!
                </p>
                <p className="mt-4 border-l-2 border-emerald-400 pl-4 text-sm leading-6 text-emerald-100">
                  Please open your inbox at {authEmail} and click the verification link to complete your account setup and start building lobbies.
                </p>
                {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    className="bg-emerald-400 px-4 py-3 text-sm font-semibold text-zinc-950 disabled:cursor-wait disabled:opacity-60"
                    disabled={isResending}
                    onClick={() => void handleResendEmail()}
                    type="button"
                  >
                    {isResending ? "Resending..." : "Resend Email"}
                  </button>
                  <button
                    className="border border-zinc-700 px-4 py-3 text-sm text-zinc-300 hover:border-zinc-500 hover:text-white"
                    onClick={() => {
                      setIsSubmitted(false);
                      setAuthTab("login");
                      setError(null);
                    }}
                    type="button"
                  >
                    Back to Login
                  </button>
                </div>
              </div>
            ) : (
            <form className="space-y-4" onSubmit={handleAuthSubmit}>
              <label className="block text-sm text-zinc-300">
                Email
                <input
                  autoComplete="email"
                  className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-emerald-400"
                  onChange={(event) => setAuthEmail(event.target.value || "")}
                  required
                  type="email"
                  value={authEmail}
                />
              </label>
              <label className="block text-sm text-zinc-300">
                Password
                <input
                  autoComplete={authTab === "login" ? "current-password" : "new-password"}
                  className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-emerald-400"
                  minLength={6}
                  onChange={(event) => setAuthPassword(event.target.value || "")}
                  required
                  type="password"
                  value={authPassword}
                />
              </label>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                className="w-full bg-emerald-400 px-4 py-3 font-semibold text-zinc-950 transition-colors hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
                disabled={isAuthenticating}
                type="submit"
              >
                {isAuthenticating
                  ? "Please wait..."
                  : authTab === "login"
                    ? "Log In"
                    : "Sign Up"}
              </button>
            </form>
            )}
          </div>
        </div>
      )}

      {isHostModalOpen && (
        <div
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/70 px-6 py-10"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsHostModalOpen(false);
          }}
        >
          <div
            aria-labelledby="host-lobby-title"
            aria-modal="true"
            className="w-full max-w-lg border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            role="dialog"
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.2em] text-emerald-400">
                  Create
                </p>
                <h2 className="mt-2 text-2xl font-semibold" id="host-lobby-title">
                  Host a lobby
                </h2>
              </div>
              <button
                aria-label="Close host lobby modal"
                className="text-2xl leading-none text-zinc-400 hover:text-white"
                onClick={() => setIsHostModalOpen(false)}
                type="button"
              >
                x
              </button>
            </div>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <label className="block text-sm text-zinc-300">
                Game Title
                <select
                  className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-emerald-400"
                  name="game_name"
                  onChange={(event) => setGameName(event.target.value || "")}
                  required
                  value={game_name}
                >
                  <option disabled value="">Select a game</option>
                  <option value="Call of Duty">Call of Duty</option>
                  <option value="Apex Legends">Apex Legends</option>
                  <option value="Valorant">Valorant</option>
                  <option value="Overwatch 2">Overwatch 2</option>
                  <option value="Fortnite">Fortnite</option>
                </select>
              </label>
              <label className="block text-sm text-zinc-300">
                Lobby Name / Description
                <input
                  className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-emerald-400"
                  name="description"
                  onChange={(event) => setDescription(event.target.value || "")}
                  placeholder="Looking for a coordinated squad"
                  required
                  value={description}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm text-zinc-300">
                  Game Mode
                  <select
                    className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-emerald-400"
                    name="mode"
                    onChange={(event) => setMode(event.target.value || "")}
                    required
                    value={mode}
                  >
                    <option disabled value="">Select a mode</option>
                    <option value="Ranked">Ranked</option>
                    <option value="Casual">Casual</option>
                    <option value="Battle Royale">Battle Royale</option>
                  </select>
                </label>
                <label className="block text-sm text-zinc-300">
                  Max Squad Size
                  <input
                    className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-emerald-400"
                    max={10}
                    min={2}
                    name="max_squad_size"
                    onChange={(event) => setMaxSquadSize(Number(event.target.value) || 2)}
                    required
                    type="number"
                    value={max_squad_size}
                  />
                </label>
              </div>
              <label className="block text-sm text-zinc-300">
                Platform
                <input
                  className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-emerald-400"
                  name="platform"
                  onChange={(event) => setPlatform(event.target.value || "")}
                  placeholder="PC, PlayStation, Xbox"
                  required
                  value={platform}
                />
              </label>
              <label className="flex items-center gap-3 text-sm text-zinc-300">
                <input
                  checked={mic_required}
                  className="h-4 w-4 accent-emerald-400"
                  name="mic_required"
                  onChange={(event) => setMicRequired(event.target.checked)}
                  type="checkbox"
                />
                Mic Required
              </label>
              <label className="block text-sm text-zinc-300">
                Discord Handle / Invite Link
                <input
                  className="mt-2 w-full border border-zinc-700 bg-zinc-950 px-3 py-3 text-white outline-none focus:border-emerald-400"
                  name="discord"
                  onChange={(event) => setDiscord(event.target.value || "")}
                  placeholder="discord.gg/invite or username#1234"
                  required
                  value={discord}
                />
              </label>
              <button
                className="w-full bg-emerald-400 px-4 py-3 font-semibold text-zinc-950 transition-colors hover:bg-emerald-300"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? "Creating..." : "Create Lobby"}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
