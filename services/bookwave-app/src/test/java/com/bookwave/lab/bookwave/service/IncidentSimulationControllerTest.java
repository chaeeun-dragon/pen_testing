package com.bookwave.lab.bookwave.service;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
        "bookwave.incident-simulation.enabled=true",
        "bookwave.incident-simulation.access-token=lab-control"
})
@AutoConfigureMockMvc
class IncidentSimulationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void dedicatedRouteReturnsFixedSyntheticBlockedResult() throws Exception {
        mockMvc.perform(post("/internal/v1/lab/incident-simulations/payment-server")
                        .header("X-Correlation-Id", "corr-sim-20260916-0001")
                        .header("X-Lab-Run-Id", "INCIDENT-SIM-20260916T000000Z")
                        .header("X-Lab-Simulation-Token", "lab-control"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scenarioId").value("PAYMENT_SERVER_INCIDENT_V1"))
                .andExpect(jsonPath("$.simulation").value(true))
                .andExpect(jsonPath("$.outcome").value("BLOCKED"))
                .andExpect(jsonPath("$.mockPgCalled").value(false))
                .andExpect(jsonPath("$.haeonCardCalled").value(false))
                .andExpect(jsonPath("$.events[1].result").value("ALERT"))
                .andExpect(jsonPath("$.events[2].result").value("BLOCKED"));
    }

    @Test
    void dedicatedRouteRejectsAnyPaymentLikeRequestBody() throws Exception {
        mockMvc.perform(post("/internal/v1/lab/incident-simulations/payment-server")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"amount\":1000,\"paymentMethodToken\":\"card-token-lab-001\"}")
                        .header("X-Correlation-Id", "corr-sim-20260916-0002")
                        .header("X-Lab-Run-Id", "INCIDENT-SIM-20260916T000001Z")
                        .header("X-Lab-Simulation-Token", "lab-control"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("SIMULATION_BODY_NOT_ALLOWED"));
    }
}
