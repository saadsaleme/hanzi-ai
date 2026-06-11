import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { isSupabaseConfigured, supabase } from "../lib/supabase";

const AuthContext = createContext(null);

function getDisplayName(user) {
  return (
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Learner"
  );
}

async function ensureProfile(user) {
  if (!supabase || !user) return null;

  const profile = {
    id: user.id,
    email: user.email,
    full_name: getDisplayName(user),
    subscription_plan: "Free Trial",
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase.from("profiles").upsert(profile, { onConflict: "id" }).select().single();

  if (error) {
    console.warn("Profile sync failed:", error.message);
    return null;
  }

  return data;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return undefined;
    }

    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) {
        const syncedProfile = await ensureProfile(data.session.user);
        setProfile(syncedProfile);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        const syncedProfile = await ensureProfile(nextSession.user);
        setProfile(syncedProfile);
      } else {
        setProfile(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      profile,
      loading,
      async signIn(email, password) {
        if (!supabase) throw new Error("Supabase is not configured in mobile/.env.");
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user && !data.user.email_confirmed_at) {
          await supabase.auth.signOut();
          throw new Error("Please verify your email before logging in.");
        }
        return data;
      },
      async signUp({ fullName, email, password }) {
        if (!supabase) throw new Error("Supabase is not configured in mobile/.env.");
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, name: fullName }
          }
        });
        if (error) throw error;
        if (data.user) {
          await ensureProfile({
            ...data.user,
            email,
            user_metadata: { ...data.user.user_metadata, full_name: fullName, name: fullName }
          });
        }
        Alert.alert("Check your email", "Account created. Please verify your email, then log in.");
        return data;
      },
      async signOut() {
        if (supabase) await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
      }
    }),
    [loading, profile, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
