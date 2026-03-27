import React, { useMemo, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  Text,
  ViewStyle,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type InputProps = TextInputProps & {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
};

export default function Input({
  label,
  error,
  containerStyle,
  style,
  placeholder,
  secureTextEntry,
  ...rest
}: InputProps): React.JSX.Element {
  const isPasswordField = Boolean(secureTextEntry);
  const [showPassword, setShowPassword] = useState(false);
  const effectiveSecureTextEntry = useMemo(() => {
    if (!isPasswordField) return secureTextEntry;
    return !showPassword;
  }, [isPasswordField, secureTextEntry, showPassword]);

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.inputWrap}>
        <TextInput
          style={[styles.input, isPasswordField && styles.inputWithRightIcon, error && styles.inputError, style]}
          placeholder={placeholder}
          placeholderTextColor="#94a3b8"
          secureTextEntry={effectiveSecureTextEntry}
          {...rest}
        />
        {isPasswordField ? (
          <TouchableOpacity
            onPress={() => setShowPassword((v) => !v)}
            style={styles.rightIconBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color="#64748b"
            />
          </TouchableOpacity>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#334155',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  inputWrap: {
    position: 'relative',
  },
  inputWithRightIcon: {
    paddingRight: 46,
  },
  rightIconBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
  },
  inputError: {
    borderColor: '#ef4444',
  },
  error: {
    fontSize: 12,
    color: '#ef4444',
    marginTop: 4,
  },
});
