import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";

const ProgressContext = createContext(null);

const defaultProgress = {
  xp: 0,
  tokens: 0,
  level: 1,
  streak: 0,
  vocabulary_completed: 0,
  reading_completed: 0,
  listening_completed: 0,
  grammar_completed: 0,
  exercises_completed: 0,
  ai_tutor_messages: 0,
  exam_score: 0
};

function levelFromXp(xp) {
  return Math.max(1, Math.floor(xp / 250) + 1);
}

export function ProgressProvider({ children }) {
  const { user } = useAuth();
  const [progress, setProgress] = useState(defaultProgress);
  const [subscription, setSubscription] = useState(null);

  const loadProgress = useCallback(async () => {
    if (!supabase || !user) return;

    const [{ data: progressRow, error: progressError }, { data: subscriptionRow }] = await Promise.all([
      supabase.from("learning_progress").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("subscriptions").select("*").eq("user_id", user.id).maybeSingle()
    ]);

    if (progressError) console.warn("Progress read failed:", progressError.message);

    const merged = {
      ...defaultProgress,
      ...(progressRow?.data || progressRow || {})
    };

    setProgress({ ...merged, level: levelFromXp(merged.xp || 0) });
    setSubscription(subscriptionRow || null);
  }, [user]);

  useEffect(() => {
    loadProgress();
  }, [loadProgress]);

  useEffect(() => {
    if (!supabase || !user) return undefined;

    const channel = supabase
      .channel(`mobile-progress-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "learning_progress", filter: `user_id=eq.${user.id}` },
        loadProgress
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${user.id}` },
        loadProgress
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadProgress, user]);

  const recordAnswer = useCallback(
    async ({ activityType, activityId, correct }) => {
      if (!supabase || !user) return;

      const xpGain = correct ? 10 : 2;
      const tokenGain = correct ? 2 : 0;
      const nextProgress = {
        ...progress,
        xp: (progress.xp || 0) + xpGain,
        tokens: (progress.tokens || 0) + tokenGain,
        level: levelFromXp((progress.xp || 0) + xpGain),
        [`${activityType}_completed`]: (progress[`${activityType}_completed`] || 0) + (correct ? 1 : 0),
        updated_at: new Date().toISOString()
      };

      setProgress(nextProgress);

      await supabase.from("answered_questions").upsert(
        {
          user_id: user.id,
          activity_type: activityType,
          activity_id: activityId,
          correct,
          xp_awarded: xpGain,
          tokens_awarded: tokenGain,
          answered_at: new Date().toISOString()
        },
        { onConflict: "user_id,activity_type,activity_id" }
      );

      await supabase.from("learning_progress").upsert(
        {
          user_id: user.id,
          data: nextProgress,
          xp: nextProgress.xp,
          tokens: nextProgress.tokens,
          level: nextProgress.level,
          updated_at: nextProgress.updated_at
        },
        { onConflict: "user_id" }
      );
    },
    [progress, user]
  );

  const value = useMemo(
    () => ({ progress, subscription, refreshProgress: loadProgress, recordAnswer }),
    [loadProgress, progress, recordAnswer, subscription]
  );

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress() {
  const context = useContext(ProgressContext);
  if (!context) throw new Error("useProgress must be used within ProgressProvider");
  return context;
}
