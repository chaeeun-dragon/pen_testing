package com.bookwave.lab.haeon.portal.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.springframework.stereotype.Component;

/**
 * 합성 회원 비밀번호 검증기다. 저장 값은 {@code SHA-256(salt || password)}의 hex이며,
 * DB fixture의 {@code SHA2(CONCAT(salt, password), 256)}와 같은 결과를 낸다.
 *
 * <p>실습용 합성 계정 전용이다. 실제 서비스라면 bcrypt/argon2 같은 느린 해시를 쓴다.
 */
@Component
public class PasswordHasher {

    public String hash(String salt, String rawPassword) {
        MessageDigest digest = sha256();
        digest.update(salt.getBytes(StandardCharsets.UTF_8));
        digest.update(rawPassword.getBytes(StandardCharsets.UTF_8));
        return HexFormat.of().formatHex(digest.digest());
    }

    public String hashToken(String token) {
        return HexFormat.of().formatHex(sha256().digest(token.getBytes(StandardCharsets.UTF_8)));
    }

    public boolean matches(String salt, String storedHash, String rawPassword) {
        if (salt == null || storedHash == null) {
            return false;
        }
        return MessageDigest.isEqual(
                storedHash.getBytes(StandardCharsets.UTF_8),
                hash(salt, rawPassword).getBytes(StandardCharsets.UTF_8));
    }

    private MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256을 사용할 수 없습니다.", ex);
        }
    }
}
