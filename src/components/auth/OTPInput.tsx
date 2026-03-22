import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

type OTPInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  digitCount?: number;
  autoFocus?: boolean;
};

export default function OTPInput({
  value,
  onChangeText,
  digitCount = 6,
  autoFocus = true,
}: OTPInputProps): React.JSX.Element {
  const handleChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, digitCount);
    onChangeText(digits);
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={handleChange}
        keyboardType="number-pad"
        maxLength={digitCount}
        autoFocus={autoFocus}
        placeholder={Array(digitCount).fill('•').join('')}
        placeholderTextColor="#cbd5e1"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: 16,
  },
  input: {
    fontSize: 24,
    letterSpacing: 12,
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    minWidth: 200,
    color: '#0f172a',
  },
});
