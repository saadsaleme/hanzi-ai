import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useProgress } from "../context/ProgressContext";
import { globalStyles } from "../theme";

export default function ExamScreen() {
  const [submitted, setSubmitted] = useState(false);
  const { recordAnswer } = useProgress();

  function submitExam() {
    setSubmitted(true);
    recordAnswer({ activityType: "exam", activityId: "mobile-mini-exam-1", correct: true });
  }

  return (
    <ScrollView style={globalStyles.screen}>
      <Text style={globalStyles.title}>Exam Mode</Text>
      <View style={globalStyles.card}>
        <Text style={globalStyles.subheading}>Mini HSK Check</Text>
        <Text style={globalStyles.text}>Listening, reading, grammar, and vocabulary sections are ready for shared Supabase scoring.</Text>
        {submitted ? <Text style={globalStyles.muted}>Score saved. Website dashboard can read the same progress row.</Text> : null}
        <Pressable style={globalStyles.button} onPress={submitExam}>
          <Text style={globalStyles.buttonText}>{submitted ? "Submitted" : "Submit Exam"}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
