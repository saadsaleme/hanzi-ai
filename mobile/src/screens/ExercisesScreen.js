import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useProgress } from "../context/ProgressContext";
import { globalStyles } from "../theme";

const exercises = [
  {
    id: "exercise-word-order-1",
    prompt: "Choose the correct sentence.",
    choices: ["我中文学习。", "我学习中文。", "中文我学习。"],
    answer: "我学习中文。",
    explanation: "The basic word order is subject + verb + object."
  },
  {
    id: "exercise-translate-1",
    prompt: "Translate: I want to buy water.",
    choices: ["我想买水。", "我想水买。", "我买想水。"],
    answer: "我想买水。",
    explanation: "想 is placed before the main verb 买."
  }
];

export default function ExercisesScreen() {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [checked, setChecked] = useState(false);
  const { recordAnswer } = useProgress();
  const exercise = exercises[index];
  const correct = selected === exercise.answer;

  function handlePrimary() {
    if (!checked) {
      setChecked(true);
      recordAnswer({ activityType: "exercises", activityId: exercise.id, correct });
      return;
    }
    setIndex((index + 1) % exercises.length);
    setSelected("");
    setChecked(false);
  }

  return (
    <ScrollView style={globalStyles.screen}>
      <Text style={globalStyles.title}>Exercises</Text>
      <Text style={globalStyles.muted}>
        Exercise {index + 1} of {exercises.length}
      </Text>
      <View style={globalStyles.card}>
        <Text style={globalStyles.heading}>{exercise.prompt}</Text>
        {exercise.choices.map((choice) => (
          <Pressable key={choice} style={globalStyles.ghostButton} onPress={() => setSelected(choice)}>
            <Text style={globalStyles.ghostText}>{selected === choice ? "Selected: " : ""}{choice}</Text>
          </Pressable>
        ))}
        {checked ? (
          <Text style={globalStyles.muted}>
            {correct ? "Correct." : "Wrong."} Answer: {exercise.answer}. {exercise.explanation}
          </Text>
        ) : null}
        <Pressable style={globalStyles.button} onPress={handlePrimary} disabled={!selected}>
          <Text style={globalStyles.buttonText}>{checked ? "Next" : "Check Answer"}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
