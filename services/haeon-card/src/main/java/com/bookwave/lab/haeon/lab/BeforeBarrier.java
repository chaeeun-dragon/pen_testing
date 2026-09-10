package com.bookwave.lab.haeon.lab;

import com.bookwave.lab.haeon.config.HaeonCardProperties;
import java.util.concurrent.BrokenBarrierException;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.stereotype.Component;

/**
 * CARD-03 Before 재현용 장벽이다. 기본값은 꺼져 있으며, 승인된 lab 프로파일에서만 켠다.
 */
@Component
public class BeforeBarrier {
    private final HaeonCardProperties properties;
    private final CyclicBarrier barrier = new CyclicBarrier(2);

    public BeforeBarrier(HaeonCardProperties properties) {
        this.properties = properties;
    }

    public boolean enabled() {
        return properties.beforeBarrierEnabled()
                && "before".equalsIgnoreCase(properties.labProfile());
    }

    public void awaitAfterRead() {
        if (!enabled()) {
            return;
        }
        long timeoutSeconds = Math.max(1, properties.barrierTimeoutSeconds());
        try {
            barrier.await(timeoutSeconds, TimeUnit.SECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            barrier.reset();
            throw new IllegalStateException("Before 장벽 대기 중 인터럽트가 발생했습니다.", ex);
        } catch (BrokenBarrierException | TimeoutException ex) {
            barrier.reset();
            throw new IllegalStateException("Before 장벽의 두 번째 요청이 제한 시간 안에 오지 않았습니다.", ex);
        }
    }
}
