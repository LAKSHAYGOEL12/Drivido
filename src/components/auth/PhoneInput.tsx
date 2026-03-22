import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Input from '../common/Input';

type PhoneInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string;
  editable?: boolean;
};

export default function PhoneInput({
  value,
  onChangeText,
  placeholder = 'Phone number',
  error,
  editable = true,
}: PhoneInputProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Input
        label="Phone"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        error={error}
        keyboardType="phone-pad"
        autoComplete="tel"
        editable={editable}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
});
