import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { playChineseAudio } from "../lib/audio";
import { useProgress } from "../context/ProgressContext";
import { colors, globalStyles } from "../theme";

export default function TutorScreen() {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("你好！我是你的 HanZi AI 老师。今天我们可以练习词汇、语法、阅读或者口语。");
  const { progress, recordAnswer } = useProgress();

  function sendPractice() {
    const nextReply = message.includes("HSK 5")
      ? "好的。HSK 5 学习要注意表达的准确性和自然度。请用“并非”造一个句子。"
      : "很好。请用中文回答：你今天学习了什么？";
    setReply(nextReply);
    setMessage("");
    recordAnswer({ activityType: "ai_tutor", activityId: `mobile-tutor-${Date.now()}`, correct: true });
  }

  return (
    <ScrollView style={globalStyles.screen}>
      <Text style={globalStyles.title}>AI Tutor</Text>
      <Text style={globalStyles.muted}>Mobile tutor limits can follow the same subscription and progress rules.</Text>
      <View style={globalStyles.card}>
        <Text style={globalStyles.subheading}>Tutor</Text>
        <Text style={globalStyles.text}>{reply}</Text>
        <View style={globalStyles.row}>
          <Pressable style={globalStyles.ghostButton} onPress={() => playChineseAudio(reply)}>
            <Text style={globalStyles.ghostText}>Play Audio</Text>
          </Pressable>
          <Pressable style={globalStyles.ghostButton} onPress={() => playChineseAudio(reply, { slow: true })}>
            <Text style={globalStyles.ghostText}>Slow</Text>
          </Pressable>
        </View>
      </View>
      <TextInput
        multiline
        placeholder="Ask for HSK practice..."
        placeholderTextColor={colors.muted}
        style={[globalStyles.input, { minHeight: 100, textAlignVertical: "top" }]}
        value={message}
        onChangeText={setMessage}
      />
      <Pressable style={globalStyles.button} onPress={sendPractice} disabled={!message.trim()}>
        <Text style={globalStyles.buttonText}>Send</Text>
      </Pressable>
      <Text style={globalStyles.muted}>Tutor practice count: {progress.ai_tutor_messages || 0}</Text>
    </ScrollView>
  );
}
