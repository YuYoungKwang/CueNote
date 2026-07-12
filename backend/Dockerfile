FROM maven:3.9.9-eclipse-temurin-21 AS build

WORKDIR /workspace
COPY pom.xml .
RUN mvn -B dependency:go-offline

COPY src src
RUN mvn -B -DskipTests package

FROM eclipse-temurin:21-jre

WORKDIR /app
RUN addgroup --system cuenote && adduser --system --ingroup cuenote cuenote
COPY --from=build /workspace/target/backend-0.1.0.jar /app/backend.jar
USER cuenote

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/backend.jar"]
