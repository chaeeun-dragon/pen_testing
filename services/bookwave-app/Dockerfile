FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY pom.xml .
RUN mvn -q -DskipTests dependency:go-offline
COPY src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/target/bookwave-app-0.1.0-SNAPSHOT.jar /app/app.jar
EXPOSE 8080
# The marker keeps the first Compose health check dependency-free.
ENTRYPOINT ["sh", "-c", "touch /tmp/service-ready && exec java -jar /app/app.jar"]
