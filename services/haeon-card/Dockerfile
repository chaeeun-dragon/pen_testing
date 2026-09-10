FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY pom.xml .
RUN mvn -q -DskipTests dependency:go-offline
COPY src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/target/haeon-card-0.1.0-SNAPSHOT.jar /app/app.jar
EXPOSE 8084
# Compose의 초기 healthcheck와 호환되도록 기동 마커를 만들고, 애플리케이션은 Actuator를 제공한다.
ENTRYPOINT ["sh", "-c", "touch /tmp/service-ready && exec java -jar /app/app.jar"]
