<?xml version="1.0" encoding="UTF-8"?>
<!--
  Sonar SG · category-coloured style for the GeoServer layer singapore_webgis:services.
  Colours match the Leaflet markers and legend.

  GeoServer → Styles → Add a new style → name "sonar_services", format SLD 1.0,
  upload this file → Validate → Save. Then Layers → services → Publishing →
  Default Style = sonar_services. The "All services" and per-category (CQL_FILTER)
  WMS overlays in the app will then use these colours.
-->
<StyledLayerDescriptor version="1.0.0"
    xmlns="http://www.opengis.net/sld"
    xmlns:ogc="http://www.opengis.net/ogc"
    xmlns:xlink="http://www.w3.org/1999/xlink"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>singapore_webgis:services</Name>
    <UserStyle>
      <Name>sonar_services</Name>
      <Title>Sonar SG services by category</Title>
      <FeatureTypeStyle>
        <Rule>
          <Name>Healthcare (detail)</Name>
          <Title>Healthcare</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Healthcare</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#E11D48</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">1.5</CssParameter></Stroke>
              </Mark>
              <Size>10</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Healthcare (overview)</Name>
          <Title>Healthcare</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Healthcare</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>25000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#E11D48</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke>
              </Mark>
              <Size>5</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Food (detail)</Name>
          <Title>Food</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Food</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#EA580C</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">1.5</CssParameter></Stroke>
              </Mark>
              <Size>10</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Food (overview)</Name>
          <Title>Food</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Food</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>25000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#EA580C</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke>
              </Mark>
              <Size>5</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Transport (detail)</Name>
          <Title>Transport</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Transport</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#2563EB</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">1.5</CssParameter></Stroke>
              </Mark>
              <Size>10</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Transport (overview)</Name>
          <Title>Transport</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Transport</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>25000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#2563EB</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke>
              </Mark>
              <Size>5</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Education (detail)</Name>
          <Title>Education</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Education</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#7C3AED</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">1.5</CssParameter></Stroke>
              </Mark>
              <Size>10</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Education (overview)</Name>
          <Title>Education</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Education</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>25000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#7C3AED</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke>
              </Mark>
              <Size>5</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Public Services (detail)</Name>
          <Title>Public Services</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Public Services</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#0891B2</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">1.5</CssParameter></Stroke>
              </Mark>
              <Size>10</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Public Services (overview)</Name>
          <Title>Public Services</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Public Services</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>25000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#0891B2</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke>
              </Mark>
              <Size>5</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Commercial (detail)</Name>
          <Title>Commercial</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Commercial</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#DB2777</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">1.5</CssParameter></Stroke>
              </Mark>
              <Size>10</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Commercial (overview)</Name>
          <Title>Commercial</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Commercial</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>25000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#DB2777</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke>
              </Mark>
              <Size>5</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Recreation (detail)</Name>
          <Title>Recreation</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Recreation</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MaxScaleDenominator>25000</MaxScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#16A34A</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">1.5</CssParameter></Stroke>
              </Mark>
              <Size>10</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
        <Rule>
          <Name>Recreation (overview)</Name>
          <Title>Recreation</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>category</ogc:PropertyName>
              <ogc:Literal>Recreation</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          <MinScaleDenominator>25000</MinScaleDenominator>
          <PointSymbolizer>
            <Graphic>
              <Mark>
                <WellKnownName>circle</WellKnownName>
                <Fill><CssParameter name="fill">#16A34A</CssParameter><CssParameter name="fill-opacity">0.85</CssParameter></Fill>
                <Stroke><CssParameter name="stroke">#FFFFFF</CssParameter><CssParameter name="stroke-width">0.6</CssParameter></Stroke>
              </Mark>
              <Size>5</Size>
            </Graphic>
          </PointSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
