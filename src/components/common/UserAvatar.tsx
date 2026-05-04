import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getApiBaseUrl } from '../../services/api';
import { COLORS } from '../../constants/colors';
import { avatarInitialsFromName } from '../../utils/avatarInitials';

/** Avatar sizes below this skip the badge — overlay would clip the initial. */
const VERIFIED_BADGE_MIN_AVATAR_SIZE = 28;

function parseHttpOrigin(raw: string): URL | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    return new URL(/^https?:\/\//i.test(t) ? t : `http://${t}`);
  } catch {
    return null;
  }
}

/** LAN / localhost — backend may store a different IP than EXPO_PUBLIC_API_URL on the phone. */
function isRewritableBackendHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '10.0.2.2') return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/**
 * Use the same host:port as API calls so images load when the DB has another LAN IP embedded
 * or when the server stored a full URL from a different deployment than EXPO_PUBLIC_API_URL
 * (e.g. production hostname in DB while the app points at LAN — uploads exist only on the API host).
 */
function alignAbsoluteUrlWithApiBase(absoluteUrl: string): string {
  const apiOrigin = parseHttpOrigin(getApiBaseUrl());
  if (!apiOrigin) return absoluteUrl;
  let img: URL;
  try {
    img = new URL(absoluteUrl);
  } catch {
    return absoluteUrl;
  }
  const p = img.pathname.toLowerCase();
  const looksLikeAppStatic =
    p.includes('/uploads/') ||
    p.includes('/avatar') ||
    p.includes('/static/') ||
    p.includes('/files/');
  if (!looksLikeAppStatic) return absoluteUrl;
  if (img.origin === apiOrigin.origin) return absoluteUrl;

  // Prefer aligning /uploads/... to API origin whenever it differs (covers LAN mismatch + wrong env URL).
  if (p.includes('/uploads/')) {
    return `${apiOrigin.origin}${img.pathname}${img.search}`;
  }

  if (!isRewritableBackendHost(img.hostname)) return absoluteUrl;
  return `${apiOrigin.origin}${img.pathname}${img.search}`;
}

function displayableImageUri(raw: string): string {
  const u = raw.trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return alignAbsoluteUrlWithApiBase(u);
  if (/^(file|content|assets-library):\/\//i.test(u) || u.startsWith('blob:')) return u;
  if (u.startsWith('//')) return `https:${u}`;
  const base = getApiBaseUrl().replace(/\/$/, '');
  if (!base) return u;
  return `${base}${u.startsWith('/') ? u : `/${u}`}`;
}

export type UserAvatarProps = {
  uri?: string | null;
  name: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  backgroundColor?: string;
  fallbackTextColor?: string;
  /**
   * Render the verified \u2713 badge in the bottom-right corner.
   * Backend SSOT — pass through ONLY `user.isIdentityVerified === true` from API responses.
   * Frontend never derives this from any other state.
   */
  verified?: boolean;
};

/**
 * Photo URL → image. No URL or failed load → name initials.
 * When `verified` is true and the avatar is large enough, overlays a small \u2713 badge.
 */
export default function UserAvatar({
  uri,
  name,
  size = 40,
  style,
  backgroundColor = '#dbeafe',
  fallbackTextColor = COLORS.text,
  verified = false,
}: UserAvatarProps): React.JSX.Element {
  const raw = (uri ?? '').trim();
  const imgUri = raw ? displayableImageUri(raw) : '';
  const initials = avatarInitialsFromName(name);
  const r = size / 2;
  const fontSize =
    initials.length >= 2 ? Math.round(size * 0.32) : Math.round(size * 0.42);

  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    setLoadFailed(false);
  }, [imgUri]);

  const showPhoto = imgUri.length > 0 && !loadFailed;
  const showBadge = verified === true && size >= VERIFIED_BADGE_MIN_AVATAR_SIZE;
  const badgeSize = Math.max(14, Math.round(size * 0.34));
  const badgeIconSize = Math.max(9, Math.round(badgeSize * 0.62));
  const badgeBorder = Math.max(1.5, Math.round(size * 0.04));

  return (
    <View
      style={[
        styles.wrap,
        {
          width: size,
          height: size,
        },
        style,
      ]}
    >
      <View
        style={[
          styles.clip,
          {
            width: size,
            height: size,
            borderRadius: r,
            backgroundColor: showPhoto ? COLORS.backgroundSecondary : backgroundColor,
          },
        ]}
      >
        {showPhoto ? (
          <Image
            key={imgUri}
            source={{ uri: imgUri }}
            style={{ width: size, height: size, borderRadius: r }}
            resizeMode="cover"
            onError={() => {
              if (__DEV__) {
                console.warn('[UserAvatar] Failed to load image (check API host vs .env):', imgUri);
              }
              setLoadFailed(true);
            }}
          />
        ) : (
          <Text style={[styles.initial, { fontSize, color: fallbackTextColor }]}>{initials}</Text>
        )}
      </View>
      {showBadge ? (
        <View
          pointerEvents="none"
          style={[
            styles.badge,
            {
              width: badgeSize,
              height: badgeSize,
              borderRadius: badgeSize / 2,
              borderWidth: badgeBorder,
            },
          ]}
          accessible
          accessibilityRole="image"
          accessibilityLabel="Identity verified"
        >
          <Ionicons name="checkmark" size={badgeIconSize} color={COLORS.white} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  clip: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initial: { fontWeight: '800' },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    backgroundColor: '#1d9bf0',
    borderColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
