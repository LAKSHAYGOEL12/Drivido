import React from 'react';
import Button from '../common/Button';

type BookingButtonProps = {
  onPress: () => void;
  label?: string;
  disabled?: boolean;
};

export default function BookingButton({
  onPress,
  label = 'Book',
  disabled,
}: BookingButtonProps): React.JSX.Element {
  return (
    <Button
      title={label}
      onPress={onPress}
      disabled={disabled}
      variant="primary"
    />
  );
}
