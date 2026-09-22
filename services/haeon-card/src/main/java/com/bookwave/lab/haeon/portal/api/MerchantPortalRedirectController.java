package com.bookwave.lab.haeon.portal.api;

import java.net.URI;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * Keeps the direct member-portal development port usable while the merchant
 * service itself remains isolated behind the local gateway.
 */
@Controller
public class MerchantPortalRedirectController {

    @GetMapping({"/merchant", "/merchant/"})
    public ResponseEntity<Void> merchantPortal() {
        return ResponseEntity.status(302)
                .header(HttpHeaders.LOCATION, URI.create("http://haeon.localhost:8090/merchant/").toString())
                .build();
    }
}
