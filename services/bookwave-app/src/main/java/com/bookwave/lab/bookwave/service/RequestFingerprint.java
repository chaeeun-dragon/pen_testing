package com.bookwave.lab.bookwave.service;

import com.bookwave.lab.bookwave.api.PaymentRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.springframework.stereotype.Component;

@Component
public class RequestFingerprint {
    public String of(PaymentRequest request) {
        String canonical = String.join("|",
                request.orderNo(),
                Long.toString(request.amount()),
                request.currency(),
                request.paymentMethodToken());
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(canonical.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is required", ex);
        }
    }
}
