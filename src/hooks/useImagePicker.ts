import { useCallback, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';

export type PickedImage = {
  uri: string;
  width: number;
  height: number;
  type?: 'image' | 'video';
};

export type UseImagePickerResult = {
  image: PickedImage | null;
  isLoading: boolean;
  error: string | null;
  pickFromGallery: (options?: ImagePicker.ImagePickerOptions) => Promise<PickedImage | null>;
  takePhoto: (options?: ImagePicker.ImagePickerOptions) => Promise<PickedImage | null>;
  clear: () => void;
};

/**
 * Pick image from gallery or camera (e.g. Aadhaar photo upload).
 * Install: npx expo install expo-image-picker
 */
export function useImagePicker(): UseImagePickerResult {
  const [image, setImage] = useState<PickedImage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFromGallery = useCallback(
    async (options?: ImagePicker.ImagePickerOptions) => {
      setIsLoading(true);
      setError(null);
      try {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          setError('Gallery permission denied');
          return null;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.8,
          ...options,
        });
        if (result.canceled) return null;
        const asset = result.assets[0];
        const picked: PickedImage = {
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          type: 'image',
        };
        setImage(picked);
        return picked;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to pick image');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const takePhoto = useCallback(
    async (options?: ImagePicker.ImagePickerOptions) => {
      setIsLoading(true);
      setError(null);
      try {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          setError('Camera permission denied');
          return null;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [4, 3],
          quality: 0.8,
          ...options,
        });
        if (result.canceled) return null;
        const asset = result.assets[0];
        const picked: PickedImage = {
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          type: 'image',
        };
        setImage(picked);
        return picked;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to take photo');
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  const clear = useCallback(() => {
    setImage(null);
    setError(null);
  }, []);

  return {
    image,
    isLoading,
    error,
    pickFromGallery,
    takePhoto,
    clear,
  };
}
